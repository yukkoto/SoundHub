import React, { createContext, startTransition, useContext, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

const AppContext = createContext(null);

async function requestJson(url, options = {}) {
  const init = { credentials: 'same-origin', ...options };
  const headers = new Headers(options.headers || {});
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;

  if (init.body && !isForm && typeof init.body !== 'string') {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(init.body);
  }

  if (!headers.has('accept')) headers.set('accept', 'application/json');
  init.headers = headers;

  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = null;
    }
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || text || `Request failed with status ${response.status}`);
  }

  return payload;
}

function useAsyncData(loader, deps) {
  const [state, setState] = useState({
    loading: true,
    data: null,
    error: ''
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true, error: '' }));

    Promise.resolve()
      .then(loader)
      .then(data => {
        if (cancelled) return;
        startTransition(() => {
          setState({ loading: false, data, error: '' });
        });
      })
      .catch(error => {
        if (cancelled) return;
        setState({
          loading: false,
          data: null,
          error: error.message || String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  return {
    ...state,
    refresh: () => setTick(value => value + 1)
  };
}

function useApp() {
  return useContext(AppContext);
}

function prettyRole(role) {
  if (role === 'admin') return 'Администратор';
  if (role === 'artist') return 'Исполнитель';
  return 'Слушатель';
}

function statNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
}

function safeDate(value) {
  if (!value) return 'сейчас';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'сейчас';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short'
  }).format(date);
}

function prettyProvider(provider) {
  if (provider === 'google') return 'Google';
  if (provider === 'yandex') return 'Яндекс';
  if (provider === 'vk') return 'VK';
  return 'SoundHub';
}

function trackBadgeLabel(track) {
  if (track?.status === 'pending') return 'На проверке';
  if (track?.status === 'rejected') return 'Скрыт';
  if (track?.sourceProvider === 'musicapi') return 'MusicAPI';
  if (track?.sourceProvider === 'deezer') return 'Deezer';
  return 'Трек';
}

function genericTagline(value, fallback = 'Артист SoundHub') {
  if (!value) return fallback;
  const normalized = String(value).trim();
  const lowered = normalized.toLowerCase();
  if (!normalized) return fallback;
  if (lowered.includes('deezer') || lowered.includes('imported') || lowered.includes('импорт') || lowered.includes('api')) return fallback;
  return normalized;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatPlaybackTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function resolveTrackSource(track) {
  return track?.audio || track?.preview || null;
}

function trackIdentity(track) {
  if (track?.id) return `id:${track.id}`;
  const source = resolveTrackSource(track);
  if (source) return `src:${source}`;
  return `fallback:${track?.title || ''}:${track?.artist || track?.artistName || ''}`;
}

function isSameTrack(left, right) {
  return Boolean(left && right) && trackIdentity(left) === trackIdentity(right);
}

function toAbsoluteUrl(value) {
  if (!value) return '';
  if (typeof window === 'undefined') return String(value);
  try {
    return new URL(String(value), window.location.origin).href;
  } catch (_) {
    return String(value);
  }
}

function buildPlaybackQueue(queue, currentTrack) {
  const items = [];
  const seen = new Set();
  const sourceQueue = Array.isArray(queue) && queue.length ? queue : [];

  for (const item of sourceQueue) {
    if (!item) continue;
    const key = trackIdentity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      ...item,
      audio: resolveTrackSource(item)
    });
  }

  if (currentTrack) {
    const currentKey = trackIdentity(currentTrack);
    if (!seen.has(currentKey)) {
      items.push({
        ...currentTrack,
        audio: resolveTrackSource(currentTrack)
      });
    }
  }

  const index = currentTrack ? items.findIndex(item => isSameTrack(item, currentTrack)) : -1;
  return {
    items,
    index
  };
}

function sanitizeClientNextUrl(nextUrl) {
  const value = String(nextUrl || '/');
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function AppProvider({ children }) {
  const [bootstrap, setBootstrap] = useState({
    loading: true,
    data: null,
    error: ''
  });
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'night';
    return localStorage.getItem('soundhub_theme') || 'night';
  });
  const [toast, setToast] = useState(null);
  const [player, setPlayer] = useState(() => {
    let volume = 0.72;

    if (typeof window !== 'undefined') {
      const savedVolume = Number(localStorage.getItem('soundhub_volume'));
      if (Number.isFinite(savedVolume)) volume = clamp(savedVolume, 0, 1);
    }

    return {
      current: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      queue: [],
      currentIndex: -1,
      volume
    };
  });
  const audioRef = useRef(null);
  const playerRef = useRef(player);
  const notifyRef = useRef(() => {});
  const playTrackRef = useRef(() => Promise.resolve());

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    let cancelled = false;
    requestJson('/api/bootstrap')
      .then(data => {
        if (cancelled) return;
        setBootstrap({ loading: false, data, error: '' });
      })
      .catch(error => {
        if (cancelled) return;
        setBootstrap({
          loading: false,
          data: null,
          error: error.message || 'Не удалось загрузить приложение'
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('soundhub_theme', theme);
  }, [theme]);

  function notify(message, tone = 'info') {
    setToast({ message, tone });
  }

  notifyRef.current = notify;

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = player.volume;

    if (typeof window !== 'undefined') {
      localStorage.setItem('soundhub_volume', String(player.volume));
    }
  }, [player.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const sync = () => {
      setPlayer(prev => ({
        ...prev,
        playing: !audio.paused,
        currentTime: audio.currentTime || 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : prev.duration
      }));
    };

    const handleEnded = () => {
      const snapshot = playerRef.current;
      const nextTrack = snapshot.queue[snapshot.currentIndex + 1];

      if (nextTrack) {
        playTrackRef.current(nextTrack, {
          queue: snapshot.queue,
          index: snapshot.currentIndex + 1
        });
        return;
      }

      setPlayer(prev => ({
        ...prev,
        playing: false,
        currentTime: prev.duration
      }));
    };

    const handleError = () => {
      notifyRef.current('Не удалось воспроизвести этот трек', 'error');
      setPlayer(prev => ({
        ...prev,
        playing: false
      }));
    };

    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('loadedmetadata', sync);
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('loadedmetadata', sync);
      audio.removeEventListener('play', sync);
      audio.removeEventListener('pause', sync);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  async function reloadBootstrap(silent = false) {
    if (!silent) setBootstrap(prev => ({ ...prev, loading: true }));

    try {
      const data = await requestJson('/api/bootstrap');
      setBootstrap({ loading: false, data, error: '' });
    } catch (error) {
      setBootstrap({
        loading: false,
        data: null,
        error: error.message || 'Не удалось обновить приложение'
      });
    }
  }

  function bumpCatalog() {
    setCatalogVersion(value => value + 1);
  }

  function toggleTheme() {
    setTheme(prev => (prev === 'light' ? 'night' : 'light'));
  }

  function mergeTrackIntoPlayer(resolvedTrack) {
    const source = resolveTrackSource(resolvedTrack);

    setPlayer(prev => {
      if (!isSameTrack(prev.current, resolvedTrack)) return prev;

      const mergedCurrent = {
        ...prev.current,
        ...resolvedTrack,
        audio: source || resolveTrackSource(prev.current)
      };

      const nextQueue = prev.queue.map(item =>
        isSameTrack(item, resolvedTrack)
          ? {
              ...item,
              ...resolvedTrack,
              audio: source || resolveTrackSource(item)
            }
          : item
      );

      return {
        ...prev,
        current: mergedCurrent,
        queue: nextQueue,
        duration: resolvedTrack.durationSeconds || prev.duration
      };
    });
  }

  async function startPlayback(track, options = {}) {
    const audio = audioRef.current;
    const source = resolveTrackSource(track);

    if (!audio || !source) {
      throw new Error('У этого трека нет доступного аудио');
    }

    const preparedTrack = {
      ...track,
      audio: source
    };
    const preparedQueue = buildPlaybackQueue(options.queue, preparedTrack);
    const nextIndex =
      Number.isInteger(options.index) && options.index >= 0 ? options.index : preparedQueue.index;
    const sameSource = toAbsoluteUrl(audio.src) === toAbsoluteUrl(source);
    const shouldRestart = options.restart !== false;

    if (!sameSource) {
      audio.src = source;
      audio.currentTime = 0;
    } else if (shouldRestart) {
      audio.currentTime = 0;
    }

    setPlayer(prev => ({
      ...prev,
      current: preparedTrack,
      playing: true,
      currentTime: shouldRestart || !sameSource ? 0 : audio.currentTime || prev.currentTime,
      duration: preparedTrack.durationSeconds || (sameSource && !shouldRestart ? prev.duration : 0),
      queue: preparedQueue.items,
      currentIndex: nextIndex
    }));

    try {
      await audio.play();
    } catch (error) {
      setPlayer(prev => ({
        ...prev,
        playing: false
      }));
      throw error;
    }
  }

  async function playTrack(track, options = {}) {
    if (!track) return;

    try {
      const source = resolveTrackSource(track);

      if (source) {
        await startPlayback(
          {
            ...track,
            audio: source
          },
          options
        );

        if (track.id) {
          requestJson(`/api/play/${track.id}`, { method: 'POST' }).catch(() => {});
          requestJson(`/api/tracks/${track.id}`)
            .then(payload => {
              if (payload?.track) mergeTrackIntoPlayer(payload.track);
            })
            .catch(() => {});
        }

        return;
      }

      if (!track.id) {
        throw new Error('У этого трека нет доступного аудио');
      }

      const payload = await requestJson(`/api/tracks/${track.id}`);
      const resolved = payload.track;
      const resolvedSource = resolveTrackSource(resolved);

      if (!resolvedSource) {
        throw new Error('У этого трека нет доступного аудио');
      }

      await startPlayback(
        {
          ...resolved,
          audio: resolvedSource
        },
        options
      );
      requestJson(`/api/play/${track.id}`, { method: 'POST' }).catch(() => {});
    } catch (error) {
      notify(error.message || 'Не удалось подготовить трек', 'error');
    }
  }

  playTrackRef.current = playTrack;

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !player.current) return;
    if (audio.paused) {
      audio.play().catch(() => notify('Не удалось продолжить воспроизведение', 'error'));
    } else {
      audio.pause();
    }
  }

  function seekTo(value) {
    const audio = audioRef.current;
    const duration = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : playerRef.current.duration;
    if (!audio || !duration) return;

    const nextTime = clamp(Number(value) || 0, 0, duration);
    audio.currentTime = nextTime;
    setPlayer(prev => ({
      ...prev,
      currentTime: nextTime
    }));
  }

  function setVolume(value) {
    const nextVolume = clamp(Number(value) || 0, 0, 1);
    const audio = audioRef.current;
    if (audio) audio.volume = nextVolume;
    setPlayer(prev => ({
      ...prev,
      volume: nextVolume
    }));
  }

  function skipTrack(step) {
    const snapshot = playerRef.current;
    const audio = audioRef.current;

    if (!snapshot.current) return;

    if (step < 0 && audio && audio.currentTime > 3) {
      seekTo(0);
      return;
    }

    const nextIndex = snapshot.currentIndex + step;
    if (nextIndex < 0 || nextIndex >= snapshot.queue.length) {
      if (step < 0) seekTo(0);
      return;
    }

    playTrack(snapshot.queue[nextIndex], {
      queue: snapshot.queue,
      index: nextIndex
    });
  }

  async function toggleLike(trackId) {
    const payload = await requestJson(`/api/like/${trackId}`, { method: 'POST' });
    setBootstrap(prev => {
      if (!prev.data) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          likes: payload.likes || []
        }
      };
    });
    bumpCatalog();
    return payload;
  }

  async function createPlaylist(title, description) {
    const payload = await requestJson('/api/playlists', {
      method: 'POST',
      body: { title, description }
    });
    notify('Плейлист создан', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
    return payload.playlist;
  }

  async function addTrackToPlaylist(playlistId, trackId) {
    const payload = await requestJson(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: { trackId }
    });
    notify('Трек добавлен в плейлист', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
    return payload.playlist;
  }

  async function removeTrackFromPlaylist(playlistId, trackId) {
    const payload = await requestJson(`/api/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE'
    });
    notify('Трек удалён из плейлиста', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
    return payload.playlist;
  }

  async function deletePlaylist(playlistId) {
    await requestJson(`/api/playlists/${playlistId}`, { method: 'DELETE' });
    notify('Плейлист удалён', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
  }

  async function login(values) {
    const payload = await requestJson('/api/session/login', {
      method: 'POST',
      body: values
    });
    notify('Вход выполнен', 'success');
    await reloadBootstrap();
    bumpCatalog();
    return payload.user;
  }

  async function register(values) {
    const payload = await requestJson('/api/session/register', {
      method: 'POST',
      body: values
    });
    notify('Аккаунт создан', 'success');
    await reloadBootstrap();
    bumpCatalog();
    return payload.user;
  }

  async function logout() {
    await requestJson('/api/session/logout', { method: 'POST' });
    notify('Вы вышли из аккаунта', 'success');
    await reloadBootstrap();
    bumpCatalog();
  }

  async function syncCatalog(limit = 0) {
    const payload = await requestJson('/api/catalog/sync', {
      method: 'POST',
      body: limit ? { limit } : {}
    });
    notify(`Каталог обновлён: ${payload.total} треков`, 'success');
    bumpCatalog();
    await reloadBootstrap(true);
    return payload.tracks;
  }

  async function approveTrack(trackId) {
    await requestJson(`/api/admin/tracks/${trackId}/approve`, { method: 'POST' });
    notify('Трек опубликован', 'success');
    bumpCatalog();
  }

  async function rejectTrack(trackId) {
    await requestJson(`/api/admin/tracks/${trackId}/reject`, { method: 'POST' });
    notify('Трек отклонён', 'warning');
    bumpCatalog();
  }

  async function deleteTrack(trackId) {
    await requestJson(`/api/admin/tracks/${trackId}`, { method: 'DELETE' });
    notify('Трек удалён', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
  }

  async function deleteAdminPlaylist(playlistId) {
    await requestJson(`/api/admin/playlists/${playlistId}`, { method: 'DELETE' });
    notify('Плейлист удалён', 'success');
    bumpCatalog();
    await reloadBootstrap(true);
  }

  async function uploadTrack(values) {
    const form = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      form.append(key, value);
    });

    const payload = await requestJson('/api/artist/upload', {
      method: 'POST',
      body: form
    });

    notify('Трек отправлен на модерацию', 'success');
    bumpCatalog();
    return payload.track;
  }

  const contextValue = {
    bootstrap,
    catalogVersion,
    theme,
    toast,
    player,
    audioRef,
    toggleTheme,
    notify,
    reloadBootstrap,
    playTrack,
    togglePlayback,
    seekTo,
    skipTrack,
    setVolume,
    toggleLike,
    createPlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    login,
    register,
    logout,
    syncCatalog,
    approveTrack,
    rejectTrack,
    deleteTrack,
    deleteAdminPlaylist,
    uploadTrack
  };

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user || null;

  return (
    <div className="app-shell">
      <audio ref={app.audioRef} preload="none" />
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="topbar">
        <div className="brand-lockup">
          <Link to="/" className="brand">
            <span className="brand-mark" />
            <span className="brand-copy">
              <strong>SoundHub</strong>
            </span>
          </Link>

          <nav className="topnav">
            <NavLink to="/" end>
              Главная
            </NavLink>
            <NavLink to="/search">Обзор</NavLink>
            <NavLink to="/playlists">Подборки</NavLink>
            <NavLink to="/library">Библиотека</NavLink>
            <NavLink to="/profile">Профиль</NavLink>
            {viewer?.role === 'artist' ? <NavLink to="/artist/upload">Загрузить</NavLink> : null}
            {viewer?.role === 'admin' ? <NavLink to="/admin">Админ</NavLink> : null}
          </nav>
        </div>

        <div className="topbar-actions">
          <button className="ghost-btn" type="button" onClick={app.toggleTheme}>
            {app.theme === 'light' ? 'Ночь' : 'Свет'}
          </button>

          <div className="viewer-chip">
            <span>{viewer ? viewer.displayName : 'Гость'}</span>
            <small>{viewer ? prettyRole(viewer.role) : 'Свободный режим'}</small>
          </div>

          {!viewer ? (
            <>
              <Link className="ghost-btn" to="/register">
                Регистрация
              </Link>
              <Link className="primary-btn" to="/login">
                Войти
              </Link>
            </>
          ) : (
            <button className="primary-btn" type="button" onClick={() => app.logout()}>
              Выйти
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        {app.bootstrap.error ? <InlineAlert tone="error">{app.bootstrap.error}</InlineAlert> : null}
        {app.bootstrap.loading ? (
          <LoadingBlock label="Готовлю интерфейс и проверяю сессию" />
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/author/:id" element={<AuthorPage />} />
            <Route path="/track/:id" element={<TrackPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/artist/upload" element={<UploadPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>

      <PlayerBar />

      {app.toast ? (
        <div className={`toast toast-${app.toast.tone}`}>
          <strong>{app.toast.message}</strong>
        </div>
      ) : null}
    </div>
  );
}

function PageFrame({ eyebrow, title, subtitle, actions, children }) {
  const hasHeader = eyebrow || title || subtitle || actions;

  return (
    <section className="page-frame">
      {hasHeader ? (
        <div className="page-head">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            {title ? <h1>{title}</h1> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="page-body">{children}</div>
    </section>
  );
}

function InlineAlert({ tone = 'info', children }) {
  return <div className={`inline-alert inline-alert-${tone}`}>{children}</div>;
}

function LoadingBlock({ label }) {
  return (
    <div className="state-card">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  );
}

function ErrorBlock({ error, onRetry }) {
  return (
    <div className="state-card">
      <h3>Что-то пошло не так</h3>
      <p>{error}</p>
      {onRetry ? (
        <button className="primary-btn" type="button" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ title, text, action }) {
  return (
    <div className="state-card">
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function MetricStrip({ items }) {
  return (
    <div className="metric-strip">
      {items.map(item => (
        <div className="metric-card" key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function IconHeart({ active = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`icon-heart${active ? ' icon-heart-active' : ''}`}>
      <path d="M12 20.5 4.8 13.6a4.9 4.9 0 0 1 6.9-7l.3.3.3-.3a4.9 4.9 0 1 1 6.9 7z" />
    </svg>
  );
}

function PlaylistAdder({ trackId }) {
  const app = useApp();
  const viewer = app.bootstrap.data?.user;
  const options = app.bootstrap.data?.playlistOptions || [];
  const [playlistId, setPlaylistId] = useState(options[0]?.id || '');

  useEffect(() => {
    if (!playlistId && options.length) setPlaylistId(options[0].id);
  }, [playlistId, options]);

  if (!viewer) {
    return (
      <Link className="inline-link" to="/login">
        Войти для плейлистов
      </Link>
    );
  }

  if (!options.length) {
    return (
      <Link className="inline-link" to="/playlists">
        Создать плейлист
      </Link>
    );
  }

  return (
    <div className="playlist-adder">
      <select value={playlistId} onChange={event => setPlaylistId(event.target.value)}>
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
      <button
        className="ghost-btn small-btn"
        type="button"
        onClick={() => {
          if (!playlistId) return;
          app.addTrackToPlaylist(playlistId, trackId).catch(error => app.notify(error.message, 'error'));
        }}
      >
        Добавить
      </button>
    </div>
  );
}

function TrackSourceLinks({ track }) {
  const items = [
    track?.providerUrl && track?.providerLabel ? { href: track.providerUrl, label: track.providerLabel, external: true } : null,
    track?.youtubeUrl ? { href: track.youtubeUrl, label: 'YouTube', external: true } : null,
    track?.spotifyUrl ? { href: track.spotifyUrl, label: 'Spotify', external: true } : null,
    track?.downloadUrl ? { href: track.downloadUrl, label: 'Скачать', external: false } : null
  ].filter(Boolean);

  if (!items.length) return null;

  return (
    <div className="source-links">
      {items.map(item => (
        <a
          key={`${track?.id || trackIdentity(track)}:${item.label}`}
          className="ghost-btn small-btn"
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noreferrer' : undefined}
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}

function TrackCard({ track, queue = [] }) {
  const app = useApp();
  const likeLabel = track.isLiked ? 'Убрать из понравившихся' : 'Добавить в понравившиеся';
  const cardBadge = trackBadgeLabel(track);

  return (
    <article className="track-card">
      <div className="track-art">
        <img src={track.cover || '/assets/covers/default.png'} alt={track.title} />
        <span className="track-badge">{cardBadge}</span>
      </div>

      <div className="track-meta">
        <div className="track-heading">
          <h3>{track.title}</h3>
          <small>{track.artist || track.artistName || 'Неизвестный артист'}</small>
        </div>

        <p>{track.albumTitle || track.genre || 'Коллекция SoundHub'}</p>

        <div className="meta-line">
          <span>{track.duration || '0:00'}</span>
          <span>{statNumber(track.plays)} прослушиваний</span>
          <span>{statNumber(track.likes)} лайков</span>
        </div>

        <div className="track-actions">
          <button
            className="primary-btn small-btn"
            type="button"
            onClick={() =>
              app
                .playTrack(
                  {
                    ...track,
                    audio: track.audio || track.preview
                  },
                  { queue }
                )
                .catch?.(() => {})
            }
          >
            Слушать
          </button>

          <Link className="ghost-btn small-btn" to={`/track/${track.id}`}>
            Карточка
          </Link>
          <button
            className={`icon-btn heart-btn ${track.isLiked ? 'is-active' : ''}`}
            type="button"
            aria-label={likeLabel}
            title={likeLabel}
            onClick={() =>
              app
                .toggleLike(track.id)
                .catch(error => app.notify(error.message || 'Не удалось обновить лайк', 'error'))
            }
          >
            <IconHeart active={track.isLiked} />
          </button>
        </div>

        <TrackSourceLinks track={track} />
        <PlaylistAdder trackId={track.id} />
      </div>
    </article>
  );
}

function PlaylistCard({ playlist, canManage = false, onDelete }) {
  return (
    <article className="playlist-card">
      <img src={playlist.cover || '/assets/covers/default.png'} alt={playlist.title} />
      <div className="playlist-copy">
        <div>
          <h3>{playlist.title}</h3>
          <p>{playlist.description || 'Подборка SoundHub'}</p>
        </div>
        <div className="meta-line">
          <span>{playlist.visibleCount || playlist.trackIds?.length || 0} треков</span>
          <span>{playlist.total || '0 мин'}</span>
        </div>
        <div className="track-actions">
          <Link className="primary-btn small-btn" to={`/playlist/${playlist.id}`}>
            Открыть
          </Link>
          {canManage ? (
            <button className="ghost-btn small-btn" type="button" onClick={onDelete}>
              Удалить
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function HomePage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user || null;
  const state = useAsyncData(() => requestJson('/api/home'), [app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Собираю главную страницу" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame>
      <MetricStrip
        items={[
          { label: 'Треков', value: statNumber(state.data.topTracks.length + state.data.newTracks.length) },
          { label: 'Плейлистов', value: statNumber(state.data.playlists.length) },
          { label: 'Авторов', value: statNumber(state.data.authors.length) },
          { label: 'Открытий', value: statNumber(state.data.featuredTracks.length) }
        ]}
      />

      <div className="content-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Для вас</span>
              <h2>Популярное сейчас</h2>
            </div>
            <div className="section-head-actions">
              <Link className="primary-btn small-btn" to="/search">
                Поиск
              </Link>
              <Link className="ghost-btn small-btn" to="/playlists">
                Плейлисты
              </Link>
            </div>
          </div>
          <div className="track-grid">
            {state.data.topTracks.map(track => (
              <TrackCard key={track.id} track={track} queue={state.data.topTracks} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Обновляется сейчас</span>
              <h2>Свежая волна</h2>
            </div>
            {viewer?.role === 'admin' ? (
              <button className="ghost-btn" type="button" onClick={() => app.syncCatalog().catch(error => app.notify(error.message, 'error'))}>
                Обновить каталог
              </button>
            ) : null}
          </div>
          <div className="track-grid compact-grid">
            {state.data.featuredTracks.map(track => (
              <TrackCard key={track.id} track={track} queue={state.data.featuredTracks} />
            ))}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Подборки</span>
              <h2>Плейлисты на сегодня</h2>
            </div>
          </div>
          <div className="playlist-grid">
            {state.data.playlists.map(playlist => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Авторы</span>
              <h2>Кого слушают сейчас</h2>
            </div>
          </div>
          <div className="author-grid">
            {state.data.authors.map(author => (
              <Link className="author-card" key={author.id} to={`/author/${author.id}`}>
                <img src={author.avatar || '/assets/covers/default.png'} alt={author.name} />
                <div>
                  <strong>{author.name}</strong>
                  <span>{genericTagline(author.tagline)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function SearchPage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user || null;
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const state = useAsyncData(
    () => requestJson(`/api/search${deferredQuery ? `?q=${encodeURIComponent(deferredQuery)}` : ''}`),
    [deferredQuery, app.catalogVersion]
  );

  return (
    <PageFrame
      eyebrow="Обзор"
      title="Каталог SoundHub"
      subtitle="Ищи локальные треки и подтягивай внешние совпадения из бесплатного API с готовым прослушиванием и скачиванием."
      actions={
        viewer?.role === 'admin' ? (
          <div className="page-actions">
            <button className="primary-btn" type="button" onClick={() => app.syncCatalog().catch(error => app.notify(error.message, 'error'))}>
              Обновить каталог
            </button>
          </div>
        ) : null
      }
    >
      <section className="panel panel-hero">
        <div className="overview-hero">
          <div className="overview-copy">
            <span className="eyebrow">Музыкальный обзор</span>
            <h2>Находи музыку по артисту, жанру и настроению</h2>
            <p>
              Вся музыка уже хранится в базе SoundHub: карточка трека, артист, обложка и готовый stream-link для
              плеера. Тебе остаётся только искать, слушать и сохранять любимое.
            </p>
            <div className="hero-pills">
              <span>Треки</span>
              <span>Артисты</span>
              <span>Подборки</span>
            </div>
          </div>

          <div className="overview-controls">
            <label className="search-field search-field-large">
              <span>Поиск по трекам и артистам</span>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Например: Daft Punk, The Weeknd, Molchat Doma"
              />
            </label>

            <div className="quick-import-grid">
              <div className="mini-compose">
                <strong>Локальный каталог</strong>
                <p>Поиск работает по сохранённым трекам в Postgres, а плеер получает готовый адрес на stream.</p>
                <div className="meta-line">
                  <span>База данных</span>
                  <span>Кэш аудио</span>
                  <span>Плеер</span>
                </div>
              </div>

              <div className="mini-compose">
                <strong>{deferredQuery ? 'Внешний поиск' : viewer?.role === 'admin' ? 'Обновление каталога' : 'Медиатека'}</strong>
                <p>
                  {deferredQuery
                    ? 'По запросу подтягиваются внешние совпадения из бесплатного API. Если MusicAPI не настроен, используется рабочий fallback через Deezer.'
                    : viewer?.role === 'admin'
                    ? 'Если metadata CSV обновился, подтяни свежие записи в каталог одной кнопкой.'
                    : 'Сохраняй лайки, собирай плейлисты и слушай музыку из одного места.'}
                </p>
                {deferredQuery ? (
                  <div className="meta-line">
                    <span>Deezer</span>
                    <span>MusicAPI</span>
                    <span>Download</span>
                  </div>
                ) : viewer?.role === 'admin' ? (
                  <button className="ghost-btn" type="button" onClick={() => app.syncCatalog().catch(error => app.notify(error.message, 'error'))}>
                    Пересобрать каталог
                  </button>
                ) : (
                  <div className="meta-line">
                    <span>Лайки</span>
                    <span>Плейлисты</span>
                    <span>История</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {state.loading ? <LoadingBlock label="Подбираю треки и обновляю обзор" /> : null}
      {state.error ? <ErrorBlock error={state.error} onRetry={state.refresh} /> : null}

      {!state.loading && !state.error ? (
        <>
          <div className="content-grid content-grid-balanced">
            <section className="panel panel-spotlight">
              <div className="section-head">
                <div>
                  <span className="eyebrow">{deferredQuery ? 'Уже в медиатеке' : 'Собрано для тебя'}</span>
                  <h2>{deferredQuery ? 'Совпадения в SoundHub' : 'Основной каталог'}</h2>
                </div>
              </div>
              {state.data.localResults.length ? (
                <div className="track-grid">
                  {state.data.localResults.map(track => (
                    <TrackCard key={track.id} track={track} queue={state.data.localResults} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Пока пусто"
                  text="Ничего не найдено по этому запросу. Попробуй другой поиск или обнови подборку выше."
                />
              )}
            </section>

            <section className="panel panel-spotlight">
              <div className="section-head">
                <div>
                  <span className="eyebrow">{deferredQuery ? 'Через Внешний API' : 'Для открытия'}</span>
                  <h2>{deferredQuery ? 'Найдено во внешнем поиске' : 'Подборка на сегодня'}</h2>
                </div>
              </div>
              {deferredQuery ? (
                state.data.externalResults.length ? (
                  <div className="track-grid compact-grid">
                    {state.data.externalResults.map(track => (
                      <TrackCard key={track.id} track={track} queue={state.data.externalResults} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={state.data.externalError ? 'Внешний поиск недоступен' : 'Совпадений не найдено'}
                    text={
                      state.data.externalError ||
                      'По этому запросу внешний API пока ничего не вернул. Можно попробовать другое название или ссылку.'
                    }
                  />
                )
              ) : (
                <div className="track-grid compact-grid">
                  {state.data.charts.map(track => (
                    <TrackCard key={track.id} track={track} queue={state.data.charts} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </PageFrame>
  );
}

function PlaylistsPage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user;
  const state = useAsyncData(() => requestJson('/api/playlists'), [app.catalogVersion]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  if (state.loading) return <LoadingBlock label="Собираю плейлисты" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame
      eyebrow="Плейлисты"
      title="Подборки и собственные очереди"
      subtitle="Собирай свои подборки, сохраняй любимые треки и держи всё в одной медиатеке."
    >
      {viewer ? (
        <form
          className="compose-card"
          onSubmit={event => {
            event.preventDefault();
            if (!title.trim()) return;
            app
              .createPlaylist(title.trim(), description.trim())
              .then(() => {
                setTitle('');
                setDescription('');
              })
              .catch(error => app.notify(error.message, 'error'));
          }}
        >
          <div className="section-head">
            <div>
              <span className="eyebrow">Новый плейлист</span>
              <h2>Создать подборку</h2>
            </div>
          </div>
          <div className="form-grid">
            <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Название плейлиста" />
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="Короткое описание"
            />
          </div>
          <button className="primary-btn" type="submit">
            Создать
          </button>
        </form>
      ) : (
        <InlineAlert tone="warning">Для создания собственных плейлистов нужен аккаунт.</InlineAlert>
      )}

      {state.data.playlists.length ? (
        <div className="playlist-grid">
          {state.data.playlists.map(playlist => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              canManage={Boolean(viewer && (viewer.role === 'admin' || playlist.ownerUserId === viewer.id))}
              onDelete={() => {
                if (!window.confirm('Удалить плейлист?')) return;
                app.deletePlaylist(playlist.id).catch(error => app.notify(error.message, 'error'));
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Плейлистов пока нет"
          text="Создай первый список или добавь новую подборку на странице обзора."
          action={
            <Link className="primary-btn" to="/search">
              Перейти в обзор
            </Link>
          }
        />
      )}
    </PageFrame>
  );
}

function PlaylistPage() {
  const app = useApp();
  const { id } = useParams();
  const viewer = app.bootstrap.data?.user;
  const state = useAsyncData(() => requestJson(`/api/playlists/${id}`), [id, app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Открываю плейлист" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  const canManage = Boolean(
    viewer && (viewer.role === 'admin' || state.data.playlist.ownerUserId === viewer.id)
  );

  return (
    <PageFrame
      eyebrow="Плейлист"
      title={state.data.playlist.title}
      subtitle={state.data.playlist.description || `Треков: ${state.data.items.length}`}
      actions={
        canManage ? (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              if (!window.confirm('Удалить плейлист?')) return;
              app
                .deletePlaylist(state.data.playlist.id)
                .catch(error => app.notify(error.message, 'error'));
            }}
          >
            Удалить плейлист
          </button>
        ) : null
      }
    >
      {state.data.items.length ? (
        <div className="track-grid">
          {state.data.items.map(track => (
            <div key={track.id} className="stacked-card">
              <TrackCard track={track} queue={state.data.items} />
              {canManage ? (
                <button
                  className="ghost-btn small-btn"
                  type="button"
                  onClick={() =>
                    app
                      .removeTrackFromPlaylist(state.data.playlist.id, track.id)
                      .catch(error => app.notify(error.message, 'error'))
                  }
                >
                  Удалить из плейлиста
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Плейлист пуст"
          text="Добавь треки из каталога или подбери что-нибудь новое на странице обзора."
        />
      )}
    </PageFrame>
  );
}

function AuthorPage() {
  const app = useApp();
  const { id } = useParams();
  const state = useAsyncData(() => requestJson(`/api/authors/${id}`), [id, app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Открываю профиль автора" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame
      eyebrow="Автор"
      title={state.data.author.name}
      subtitle={genericTagline(state.data.author.tagline)}
    >
      <div className="detail-hero">
        <img src={state.data.author.avatar || '/assets/covers/default.png'} alt={state.data.author.name} />
        <div>
          <p>{state.data.author.bio || 'Нет подробного описания.'}</p>
          <MetricStrip
            items={[
              { label: 'Треков', value: statNumber(state.data.stats.tracks) },
              { label: 'Подписчиков', value: statNumber(state.data.stats.followers) },
              { label: 'Прослушиваний', value: statNumber(state.data.stats.plays) }
            ]}
          />
        </div>
      </div>

      <div className="track-grid">
        {state.data.tracks.map(track => (
          <TrackCard key={track.id} track={track} queue={state.data.tracks} />
        ))}
      </div>
    </PageFrame>
  );
}

function TrackPage() {
  const app = useApp();
  const { id } = useParams();
  const state = useAsyncData(() => requestJson(`/api/tracks/${id}`), [id, app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Гружу карточку трека" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  const track = state.data.track;
  const playbackQueue = [track, ...state.data.related];

  return (
    <PageFrame
      eyebrow="Трек"
      title={track.title}
      subtitle={`${track.artist} • ${track.albumTitle || track.genre}`}
      actions={
        <div className="page-actions">
          <button className="primary-btn" type="button" onClick={() => app.playTrack(track, { queue: playbackQueue })}>
            Слушать
          </button>
          {track.downloadUrl ? (
            <a className="ghost-btn" href={track.downloadUrl}>
              Скачать
            </a>
          ) : null}
        </div>
      }
    >
      <div className="detail-hero">
        <img src={track.cover || '/assets/covers/default.png'} alt={track.title} />
        <div>
          <MetricStrip
            items={[
              { label: 'Лайков', value: statNumber(track.likes) },
              { label: 'Прослушиваний', value: statNumber(track.plays) },
              { label: 'Добавлен', value: safeDate(track.createdAt) }
            ]}
          />
          <div className="track-actions">
            <button
              className={`icon-btn heart-btn heart-btn-large ${track.isLiked ? 'is-active' : ''}`}
              type="button"
              aria-label={track.isLiked ? 'Убрать из понравившихся' : 'Добавить в понравившиеся'}
              onClick={() => app.toggleLike(track.id).catch(error => app.notify(error.message, 'error'))}
            >
              <IconHeart active={track.isLiked} />
              <span>{statNumber(track.likes)}</span>
            </button>
          </div>
          <TrackSourceLinks track={track} />
          <PlaylistAdder trackId={track.id} />
        </div>
      </div>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Related</span>
            <h2>Похожие треки</h2>
          </div>
        </div>
        <div className="track-grid compact-grid">
          {state.data.related.map(item => (
            <TrackCard key={item.id} track={item} queue={playbackQueue} />
          ))}
        </div>
      </section>
    </PageFrame>
  );
}

function LibraryPage() {
  const app = useApp();
  const state = useAsyncData(() => requestJson('/api/library'), [app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Открываю библиотеку" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame
      eyebrow="Библиотека"
      title="Сохранённые треки"
      subtitle={
        state.data.user
          ? `Ты вошёл как ${state.data.user.displayName}. Здесь лежат твои лайки и плейлисты.`
          : 'Гостевой режим. Лайки сохраняются в сессии браузера.'
      }
    >
      {state.data.likedTracks.length ? (
        <div className="track-grid">
          {state.data.likedTracks.map(track => (
            <TrackCard key={track.id} track={track} queue={state.data.likedTracks} />
          ))}
        </div>
      ) : (
        <EmptyState title="Лайков пока нет" text="Ставь лайки на карточках треков, чтобы собрать библиотеку." />
      )}
    </PageFrame>
  );
}

function OAuthLink({ enabled, href, children }) {
  if (!enabled) {
    return (
      <button className="ghost-btn is-disabled" type="button" disabled>
        {children}
      </button>
    );
  }

  return (
    <a className="ghost-btn" href={href}>
      {children}
    </a>
  );
}

function ProfilePage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user || null;
  const providers = app.bootstrap.data?.providers || {};
  const state = useAsyncData(() => requestJson('/api/profile'), [app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Открываю профиль" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame
      eyebrow="Профиль"
      title={viewer ? viewer.displayName : 'Гостевой режим'}
      subtitle={viewer ? `${prettyRole(viewer.role)} • ${viewer.email || 'без email'}` : 'Можно пользоваться каталогом без входа'}
    >
      {viewer ? (
        <>
          <MetricStrip
            items={[
              { label: 'Роль', value: prettyRole(viewer.role) },
              { label: 'Плейлистов', value: statNumber(state.data.playlists.length) },
              { label: 'Вход через', value: prettyProvider(viewer.provider) }
            ]}
          />

          <div className="content-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Аккаунт</span>
                  <h2>Данные профиля</h2>
                </div>
              </div>
              <div className="profile-card">
                <strong>{viewer.displayName}</strong>
                <span>{viewer.email || 'Email не указан'}</span>
                <span>{prettyRole(viewer.role)}</span>
                {viewer.artistId ? <Link to={`/author/${viewer.artistId}`}>Открыть страницу артиста</Link> : null}
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Подключения</span>
                  <h2>Подключения</h2>
                </div>
              </div>
              <div className="oauth-grid">
                <OAuthLink enabled={providers.google} href="/auth/google?next=/profile">
                  Google
                </OAuthLink>
                <OAuthLink enabled={providers.yandex} href="/auth/yandex?next=/profile">
                  Yandex
                </OAuthLink>
                <OAuthLink enabled={providers.vk} href="/auth/vk?next=/profile">
                  VK
                </OAuthLink>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="content-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Аккаунт</span>
                  <h2>Создать аккаунт</h2>
                </div>
              </div>
            <div className="track-actions">
              <Link className="primary-btn" to="/register">
                Регистрация
              </Link>
              <Link className="ghost-btn" to="/login">
                Войти
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">Демо</span>
                <h2>Быстрый вход</h2>
              </div>
            </div>
            <div className="oauth-grid">
              <a className="ghost-btn" href="/login/demo/user?next=/profile">
                Гость
              </a>
              <a className="ghost-btn" href="/login/demo/artist?next=/profile">
                Исполнитель
              </a>
              <a className="ghost-btn" href="/login/demo/admin?next=/profile">
                Администратор
              </a>
            </div>
          </section>
        </div>
      )}
    </PageFrame>
  );
}

function AdminPage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user;

  if (!viewer || viewer.role !== 'admin') {
    return (
      <PageFrame eyebrow="Админ" title="Доступ закрыт" subtitle="Эта страница доступна только администратору.">
        <InlineAlert tone="error">Войди под аккаунтом администратора.</InlineAlert>
      </PageFrame>
    );
  }

  const state = useAsyncData(() => requestJson('/api/admin'), [app.catalogVersion]);

  if (state.loading) return <LoadingBlock label="Открываю админ-панель" />;
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.refresh} />;

  return (
    <PageFrame
      eyebrow="Админ"
      title="Модерация и ручное управление"
      subtitle="Проверка пользовательских загрузок, ручное удаление треков и чистка плейлистов."
    >
      <div className="content-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">На проверке</span>
              <h2>На модерации</h2>
            </div>
          </div>
          {state.data.pending.length ? (
            <div className="track-grid compact-grid">
              {state.data.pending.map(track => (
                <div key={track.id} className="stacked-card">
                  <TrackCard track={track} queue={state.data.pending} />
                  <div className="track-actions">
                    <button className="primary-btn small-btn" type="button" onClick={() => app.approveTrack(track.id)}>
                      Опубликовать
                    </button>
                    <button className="ghost-btn small-btn" type="button" onClick={() => app.rejectTrack(track.id)}>
                      Отклонить
                    </button>
                    <button className="ghost-btn small-btn" type="button" onClick={() => app.deleteTrack(track.id)}>
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Очередь пуста" text="Новых пользовательских треков на модерации нет." />
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Архив</span>
              <h2>Отклонённые</h2>
            </div>
          </div>
          {state.data.rejected.length ? (
            <div className="track-grid compact-grid">
              {state.data.rejected.map(track => (
                <TrackCard key={track.id} track={track} queue={state.data.rejected} />
              ))}
            </div>
          ) : (
            <EmptyState title="Пока пусто" text="Отклонённых треков сейчас нет." />
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Плейлисты</span>
            <h2>Удаление и контроль</h2>
          </div>
        </div>
        <div className="playlist-grid">
          {state.data.playlists.map(playlist => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              canManage
              onDelete={() => {
                if (!window.confirm('Удалить плейлист?')) return;
                app.deleteAdminPlaylist(playlist.id).catch(error => app.notify(error.message, 'error'));
              }}
            />
          ))}
        </div>
      </section>
    </PageFrame>
  );
}

function UploadPage() {
  const app = useApp();
  const viewer = app.bootstrap.data?.user;
  const [form, setForm] = useState({
    title: '',
    genre: '',
    duration: ''
  });
  const [audio, setAudio] = useState(null);
  const [cover, setCover] = useState(null);

  if (!viewer || viewer.role !== 'artist') {
    return (
      <PageFrame eyebrow="Загрузка" title="Доступ закрыт" subtitle="Загрузка доступна только артисту.">
        <InlineAlert tone="warning">Войди под аккаунтом исполнителя, чтобы загружать новые треки.</InlineAlert>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      eyebrow="Загрузка"
      title="Отправить собственный трек"
      subtitle="Файл уйдёт в очередь модерации. После публикации он появится в основном каталоге SoundHub."
    >
      <form
        className="compose-card"
        onSubmit={event => {
          event.preventDefault();
          app
            .uploadTrack({
              ...form,
              audio,
              cover
            })
            .then(() => {
              setForm({ title: '', genre: '', duration: '' });
              setAudio(null);
              setCover(null);
            })
            .catch(error => app.notify(error.message, 'error'));
        }}
      >
        <div className="form-grid">
          <input
            value={form.title}
            onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
            placeholder="Название трека"
          />
          <input
            value={form.genre}
            onChange={event => setForm(prev => ({ ...prev, genre: event.target.value }))}
            placeholder="Жанр"
          />
          <input
            value={form.duration}
            onChange={event => setForm(prev => ({ ...prev, duration: event.target.value }))}
            placeholder="Длительность, например 3:24"
          />
          <label className="file-field">
            <span>Аудио файл</span>
            <input type="file" accept=".mp3,.wav,.ogg,.m4a,.aac" onChange={event => setAudio(event.target.files?.[0] || null)} />
          </label>
          <label className="file-field">
            <span>Обложка</span>
            <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={event => setCover(event.target.files?.[0] || null)} />
          </label>
        </div>
        <button className="primary-btn" type="submit">
          Отправить на модерацию
        </button>
      </form>
    </PageFrame>
  );
}

function LoginPage() {
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const nextUrl = sanitizeClientNextUrl(new URLSearchParams(location.search).get('next') || '/profile');
  const providers = app.bootstrap.data?.providers || {};
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  return (
    <PageFrame eyebrow="Вход" title="Авторизация" subtitle="Войди в аккаунт или используй быстрый вход, чтобы сохранить свою медиатеку.">
      <div className="content-grid">
        <form
          className="compose-card"
          onSubmit={event => {
            event.preventDefault();
            setErrorMessage('');
            setPending(true);
            app
              .login({ email, password })
              .then(() => navigate(nextUrl))
              .catch(error => {
                const message = error.message || 'Войти не удалось';
                setErrorMessage(message);
                app.notify(message, 'error');
              })
              .finally(() => setPending(false));
          }}
        >
          {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
          <div className="form-grid">
            <input
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="username"
              required
            />
            <input
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Пароль"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="track-actions">
            <button className="primary-btn" type="submit" disabled={pending}>
              {pending ? 'Входим...' : 'Войти'}
            </button>
            <Link className="ghost-btn" to={`/register?next=${encodeURIComponent(nextUrl)}`}>
              Создать аккаунт
            </Link>
          </div>
          <p className="form-note">Можно войти по email и паролю или использовать быстрый демо-доступ ниже.</p>
        </form>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Быстрый доступ</span>
              <h2>Быстрый вход</h2>
            </div>
          </div>
          <div className="oauth-grid">
            <a className="ghost-btn" href={`/login/demo/user?next=${encodeURIComponent(nextUrl)}`}>
              Гость
            </a>
            <a className="ghost-btn" href={`/login/demo/artist?next=${encodeURIComponent(nextUrl)}`}>
              Исполнитель
            </a>
            <a className="ghost-btn" href={`/login/demo/admin?next=${encodeURIComponent(nextUrl)}`}>
              Администратор
            </a>
            <OAuthLink enabled={providers.google} href={`/auth/google?next=${encodeURIComponent(nextUrl)}`}>
              Google
            </OAuthLink>
            <OAuthLink enabled={providers.yandex} href={`/auth/yandex?next=${encodeURIComponent(nextUrl)}`}>
              Yandex
            </OAuthLink>
            <OAuthLink enabled={providers.vk} href={`/auth/vk?next=${encodeURIComponent(nextUrl)}`}>
              VK
            </OAuthLink>
          </div>
          <p className="form-note">Если OAuth-кнопка неактивна, этот провайдер не настроен в окружении.</p>
        </section>
      </div>
    </PageFrame>
  );
}

function RegisterPage() {
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const nextUrl = sanitizeClientNextUrl(new URLSearchParams(location.search).get('next') || '/profile');
  const providers = app.bootstrap.data?.providers || {};
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    password: '',
    password2: ''
  });
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  return (
    <PageFrame eyebrow="Регистрация" title="Создать аккаунт" subtitle="После регистрации лайки и гостевые сохранения будут привязаны к новому профилю.">
      <div className="content-grid">
        <form
          className="compose-card"
          onSubmit={event => {
            event.preventDefault();
            setErrorMessage('');

            if (form.password !== form.password2) {
              const message = 'Пароли не совпадают';
              setErrorMessage(message);
              app.notify(message, 'error');
              return;
            }

            setPending(true);
            app
              .register(form)
              .then(() => navigate(nextUrl))
              .catch(error => {
                const message = error.message || 'Регистрация не удалась';
                setErrorMessage(message);
                app.notify(message, 'error');
              })
              .finally(() => setPending(false));
          }}
        >
          {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
          <div className="form-grid">
            <input
              value={form.email}
              onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))}
              placeholder="Email"
              type="email"
              autoComplete="email"
              required
            />
            <input
              value={form.displayName}
              onChange={event => setForm(prev => ({ ...prev, displayName: event.target.value }))}
              placeholder="Отображаемое имя"
              autoComplete="nickname"
            />
            <input
              value={form.password}
              onChange={event => setForm(prev => ({ ...prev, password: event.target.value }))}
              placeholder="Пароль"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <input
              value={form.password2}
              onChange={event => setForm(prev => ({ ...prev, password2: event.target.value }))}
              placeholder="Повтор пароля"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div className="track-actions">
            <button className="primary-btn" type="submit" disabled={pending}>
              {pending ? 'Создаём...' : 'Создать аккаунт'}
            </button>
            <Link className="ghost-btn" to={`/login?next=${encodeURIComponent(nextUrl)}`}>
              Уже есть аккаунт
            </Link>
          </div>
          <p className="form-note">Локальная регистрация сохраняет аккаунт сразу в базе и авторизует в текущей сессии.</p>
        </form>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">OAuth</span>
              <h2>Альтернативный вход</h2>
            </div>
          </div>
          <div className="oauth-grid">
            <OAuthLink enabled={providers.google} href={`/auth/google?next=${encodeURIComponent(nextUrl)}`}>
              Google
            </OAuthLink>
            <OAuthLink enabled={providers.yandex} href={`/auth/yandex?next=${encodeURIComponent(nextUrl)}`}>
              Yandex
            </OAuthLink>
            <OAuthLink enabled={providers.vk} href={`/auth/vk?next=${encodeURIComponent(nextUrl)}`}>
              VK
            </OAuthLink>
          </div>
          <p className="form-note">Если провайдеры не настроены, используй обычную регистрацию через email и пароль.</p>
        </section>
      </div>
    </PageFrame>
  );
}

function NotFoundPage() {
  return (
    <PageFrame eyebrow="404" title="Страница не найдена" subtitle="Такой страницы здесь нет или она была перемещена.">
      <Link className="primary-btn" to="/">
        Вернуться на главную
      </Link>
    </PageFrame>
  );
}

function PlayerBar() {
  const app = useApp();
  const current = app.player.current;

  if (!current) {
    return (
      <div className="player-shell player-shell-empty">
        <p>Выбери трек в каталоге, чтобы включить плеер.</p>
      </div>
    );
  }

  const duration = Math.max(app.player.duration || 0, app.player.currentTime || 0, 0);
  const hasPrev = app.player.currentIndex > 0;
  const hasNext = app.player.currentIndex >= 0 && app.player.currentIndex < app.player.queue.length - 1;

  return (
    <div className="player-shell">
      <div className="player-meta">
        <img src={current.cover || '/assets/covers/default.png'} alt={current.title} />
        <div>
          <strong>{current.title}</strong>
          <span>{current.artist || current.artistName || 'Неизвестный артист'}</span>
        </div>
      </div>

      <div className="player-center">
        <div className="player-transport">
          <button className="transport-btn" type="button" onClick={() => app.skipTrack(-1)} disabled={!hasPrev}>
            Назад
          </button>
          <button className="primary-btn small-btn" type="button" onClick={app.togglePlayback}>
            {app.player.playing ? 'Пауза' : 'Слушать'}
          </button>
          <button className="transport-btn" type="button" onClick={() => app.skipTrack(1)} disabled={!hasNext}>
            Дальше
          </button>
          {current.id ? (
            <Link className="ghost-btn small-btn" to={`/track/${current.id}`}>
              Карточка
            </Link>
          ) : null}
        </div>
        <div className="player-progress">
          <span>{formatPlaybackTime(app.player.currentTime)}</span>
          <input
            className="player-slider player-slider-progress"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(app.player.currentTime, duration || 0)}
            onChange={event => app.seekTo(Number(event.target.value))}
            aria-label="Перемотка трека"
          />
          <span>{formatPlaybackTime(duration)}</span>
        </div>
      </div>

      <div className="player-extra">
        <label className="player-volume">
          <span>Громкость</span>
          <input
            className="player-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={app.player.volume}
            onChange={event => app.setVolume(Number(event.target.value))}
            aria-label="Громкость"
          />
        </label>
        <span className="player-volume-value">{Math.round(app.player.volume * 100)}%</span>
      </div>
    </div>
  );
}

export default App;
