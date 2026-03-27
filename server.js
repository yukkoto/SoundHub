const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const createPgSessionStore = require('connect-pg-simple');

try {
  require('dotenv').config();
} catch (_) {}

const { getPool } = require('./db/pool');
const store = require('./db/store');
const fma = require('./services/fma');

const app = express();
const PORT = process.env.PORT || 3000;
const PgSessionStore = createPgSessionStore(session);

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client-dist');
const CLIENT_INDEX_PATH = path.join(CLIENT_DIST_DIR, 'index.html');
const UPLOAD_AUDIO_DIR = path.join(PUBLIC_DIR, 'uploads', 'audio');
const UPLOAD_COVER_DIR = path.join(PUBLIC_DIR, 'uploads', 'covers');
const MEDIA_CACHE_DIR = path.join(ROOT_DIR, '.cache', 'audio');
const SAMPLE_AUDIO_PATH = path.join(PUBLIC_DIR, 'audio', 'sample.wav');

function ensureDir(absPath) {
  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch (_) {}
}

ensureDir(UPLOAD_AUDIO_DIR);
ensureDir(UPLOAD_COVER_DIR);
ensureDir(MEDIA_CACHE_DIR);

const pendingMediaDownloads = new Map();

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getCurrentUser(req) {
  return req.currentUser || null;
}

function getGuestLikes(req) {
  if (!req.session) return [];
  if (!Array.isArray(req.session.guestLikes)) req.session.guestLikes = [];
  return req.session.guestLikes;
}

async function mergeGuestLikesIntoUser(req, userId) {
  const guestLikes = getGuestLikes(req);
  if (!guestLikes.length) return;
  await store.mergeGuestLikes(userId, guestLikes);
  req.session.guestLikes = [];
}

async function persistUserSession(req, userId) {
  if (!req.session) return;
  req.session.userId = userId;
  await mergeGuestLikesIntoUser(req, userId);

  await new Promise((resolve, reject) => {
    req.session.save(error => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function requireRole(role) {
  return (req, res, next) => {
    const user = getCurrentUser(req);
    if (!user) {
      const nextUrl = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/login?next=${nextUrl}`);
    }
    if (user.role !== role) return res.status(403).send('Недостаточно прав');
    next();
  };
}

function requireRoleJson(role) {
  return (req, res, next) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    if (user.role !== role) return res.status(403).json({ ok: false, error: 'Недостаточно прав' });
    next();
  };
}

function providerConfigured(provider) {
  const env = process.env;
  if (provider === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (provider === 'vk') return !!(env.VK_CLIENT_ID && env.VK_CLIENT_SECRET);
  if (provider === 'yandex') return !!(env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET);
  return false;
}

function getBaseUrl(req) {
  const explicit = process.env.BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function setOauthState(req, provider, state) {
  if (!req.session) return;
  if (!req.session.oauthStates) req.session.oauthStates = {};
  req.session.oauthStates[provider] = state;
}

function checkOauthState(req, provider, state) {
  const expected = req.session?.oauthStates?.[provider];
  return expected && state && expected === state;
}

function sanitizeNextUrl(nextUrl) {
  const value = String(nextUrl || '/');
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function setOauthNext(req, provider, nextUrl) {
  if (!req.session) return;
  if (!req.session.oauthNext) req.session.oauthNext = {};
  req.session.oauthNext[provider] = sanitizeNextUrl(nextUrl);
}

function consumeOauthNext(req, provider) {
  const nextUrl = req.session?.oauthNext?.[provider];
  if (req.session?.oauthNext) delete req.session.oauthNext[provider];
  return sanitizeNextUrl(nextUrl || '/');
}

function deleteManagedUpload(publicUrl) {
  if (typeof publicUrl !== 'string') return;
  if (!publicUrl.startsWith('/uploads/audio/') && !publicUrl.startsWith('/uploads/covers/')) return;

  const absPath = path.join(PUBLIC_DIR, publicUrl.replace(/^\//, ''));
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (_) {}
}

function hashString(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildArtworkSvg({ title, subtitle, seed }) {
  const digest = hashString(seed);
  const hueA = parseInt(digest.slice(0, 2), 16) % 360;
  const hueB = (hueA + 80 + (parseInt(digest.slice(2, 4), 16) % 80)) % 360;
  const glowX = 20 + (parseInt(digest.slice(4, 6), 16) % 60);
  const glowY = 18 + (parseInt(digest.slice(6, 8), 16) % 50);
  const glowR = 22 + (parseInt(digest.slice(8, 10), 16) % 20);
  const safeTitle = escapeXml(title || 'SoundHub');
  const safeSubtitle = escapeXml(subtitle || 'Music');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hueA} 72% 56%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 72% 38%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="${glowX}%" cy="${glowY}%" r="${glowR}%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.92)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="480" height="480" rx="42" fill="url(#bg)"/>
  <circle cx="380" cy="98" r="120" fill="url(#glow)" opacity="0.42"/>
  <path d="M54 366c64-108 160-155 286-144 36 3 60 9 86 20v184H54Z" fill="rgba(8, 12, 19, 0.34)"/>
  <circle cx="124" cy="136" r="44" fill="rgba(8,12,19,0.22)"/>
  <path d="M124 96v94m0-94 98-22v90" stroke="rgba(255,255,255,0.72)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="42" y="374" fill="white" font-size="38" font-family="Space Grotesk, Arial, sans-serif" font-weight="700">${safeTitle}</text>
  <text x="42" y="414" fill="rgba(255,255,255,0.78)" font-size="21" font-family="IBM Plex Mono, monospace">${safeSubtitle}</text>
</svg>`;
}

function resolvePublicAudioPath(publicUrl) {
  if (typeof publicUrl !== 'string') return null;
  if (!publicUrl.startsWith('/uploads/audio/') && !publicUrl.startsWith('/audio/')) return null;
  return path.join(PUBLIC_DIR, publicUrl.replace(/^\//, ''));
}

function getTrackCachePath(track) {
  if (track?.cacheFilePath) return track.cacheFilePath;

  const provider = String(track?.sourceProvider || 'catalog').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'catalog';
  const sourceId = String(track?.sourceTrackId || track?.id || hashString(track?.title || 'track'));
  const sourceForExt = track?.storageObjectKey || track?.originStorageUrl || track?.audio || track?.preview || '.mp3';
  let ext = '.mp3';

  if (typeof sourceForExt === 'string') {
    try {
      ext = path.extname(new URL(sourceForExt).pathname) || ext;
    } catch (_) {
      ext = path.extname(sourceForExt.split('?')[0]) || ext;
    }
  }

  return path.join(MEDIA_CACHE_DIR, provider, `${sourceId}${ext}`);
}

function getRemoteTrackUrl(track) {
  if (track?.originStorageUrl) return track.originStorageUrl;
  if (typeof track?.audio === 'string' && /^https?:\/\//i.test(track.audio)) return track.audio;
  if (typeof track?.preview === 'string' && /^https?:\/\//i.test(track.preview)) return track.preview;
  if (track?.sourceProvider === 'fma' && track?.sourceTrackId) {
    return fma.buildRemoteAudioUrl(track.sourceTrackId);
  }
  return null;
}

async function persistResponseBodyToFile(body, targetPath) {
  if (!body) throw new Error('Remote media body is empty');
  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await pipeline(Readable.fromWeb(body), fs.createWriteStream(tempPath));
  fs.renameSync(tempPath, targetPath);
}

async function ensureTrackAudioCache(track) {
  const cachePath = getTrackCachePath(track);
  if (cachePath && fs.existsSync(cachePath)) {
    if (!track?.cacheFilePath || track.cacheFilePath !== cachePath) {
      await store.setTrackCachePath(track.id, cachePath).catch(() => {});
    }
    return cachePath;
  }

  const localPublicPath = resolvePublicAudioPath(track?.audio);
  if (localPublicPath && fs.existsSync(localPublicPath)) return localPublicPath;

  if (track?.sourceProvider === 'fma' && track?.sourceTrackId) {
    const localFmaDir = String(process.env.FMA_AUDIO_DIR || '').trim();
    const localFmaPath = fma.buildLocalAudioPath(localFmaDir, track.sourceTrackId);
    if (localFmaPath && fs.existsSync(localFmaPath)) {
      ensureDir(path.dirname(cachePath));
      if (!fs.existsSync(cachePath)) fs.copyFileSync(localFmaPath, cachePath);
      await store.setTrackCachePath(track.id, cachePath).catch(() => {});
      return cachePath;
    }
  }

  const remoteUrl = getRemoteTrackUrl(track);
  if (!remoteUrl) {
    throw new Error('Для этого трека не настроен источник аудио');
  }

  const inflight = pendingMediaDownloads.get(cachePath);
  if (inflight) {
    await inflight;
    return cachePath;
  }

  const downloadPromise = (async () => {
    const response = await fetch(remoteUrl, {
      headers: {
        accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1'
      }
    });

    if (!response.ok) {
      throw new Error(`Не удалось получить аудио из origin (${response.status})`);
    }

    await persistResponseBodyToFile(response.body, cachePath);
    await store.setTrackCachePath(track.id, cachePath).catch(() => {});
  })();

  pendingMediaDownloads.set(cachePath, downloadPromise);

  try {
    await downloadPromise;
    return cachePath;
  } finally {
    pendingMediaDownloads.delete(cachePath);
  }
}

function sendFileWithRange(req, res, absPath, contentType = 'audio/mpeg') {
  const stat = fs.statSync(absPath);
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(absPath).pipe(res);
    return;
  }

  const match = String(range).match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  const safeStart = Math.max(0, Math.min(start, stat.size - 1));
  const safeEnd = Math.max(safeStart, Math.min(end, stat.size - 1));

  res.status(206);
  res.setHeader('Content-Range', `bytes ${safeStart}-${safeEnd}/${stat.size}`);
  res.setHeader('Content-Length', safeEnd - safeStart + 1);
  fs.createReadStream(absPath, { start: safeStart, end: safeEnd }).pipe(res);
}

function normalizeTrack(track) {
  const normalized = { ...track };
  const hasRemoteAudio = typeof normalized.audio === 'string' && /^https?:\/\//i.test(normalized.audio);
  const hasRemotePreview = typeof normalized.preview === 'string' && /^https?:\/\//i.test(normalized.preview);
  const shouldUseManagedStream = Boolean(
    normalized.id &&
      (normalized.originStorageUrl ||
        normalized.cacheFilePath ||
        normalized.sourceProvider ||
        hasRemoteAudio ||
        hasRemotePreview)
  );

  if (!normalized.status) normalized.status = 'published';
  if (!normalized.cover) normalized.cover = '/assets/covers/default.png';
  if (shouldUseManagedStream) {
    normalized.audio = `/media/tracks/${normalized.id}/stream`;
  } else if (!normalized.audio) {
    normalized.audio =
      normalized.preview ||
      '/audio/sample.wav';
  }
  if (!normalized.preview) normalized.preview = normalized.audio || null;
  if (!normalized.duration) normalized.duration = '0:00';
  if (!Number.isFinite(Number(normalized.durationSeconds))) normalized.durationSeconds = 0;
  if (!Number.isFinite(Number(normalized.plays))) normalized.plays = 0;
  if (!Number.isFinite(Number(normalized.likes))) normalized.likes = 0;

  return normalized;
}

function isTrackVisibleToUser(track, user) {
  const status = track.status || 'published';
  if (status === 'published') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'artist' && user.artistId && track.artistId === user.artistId) return true;
  return false;
}

function decorateTrack(track, authorById, likedIds) {
  const likedSet = new Set(likedIds || []);
  const author = authorById[track.artistId] || null;

  return {
    ...track,
    artist: author?.name || 'Unknown',
    artistAvatar: author?.avatar || null,
    author,
    isLiked: likedSet.has(track.id)
  };
}

function decorateTracks(tracks, authorById, likedIds) {
  return tracks.map(track => decorateTrack(track, authorById, likedIds));
}

function buildPlaylistPreview(playlist, trackMap) {
  const items = (playlist.trackIds || []).map(id => trackMap[id]).filter(Boolean);

  return {
    ...playlist,
    visibleCount: items.length,
    sampleTracks: items.slice(0, 4)
  };
}

function sendClientApp(res) {
  if (!fs.existsSync(CLIENT_INDEX_PATH)) {
    return res.status(500).send('React client build is missing. Run npm run build:client.');
  }

  return res.sendFile(CLIENT_INDEX_PATH);
}

function newTrackId() {
  return `t_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function serializeViewer(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    provider: user.provider,
    avatar: user.avatar,
    artistId: user.artistId
  };
}

async function syncFmaCatalog(options = {}) {
  const tracks = fma.loadCatalogTracks({
    limit: options.limit,
    subset: options.subset,
    tracksCsv: options.tracksCsv,
    genresCsv: options.genresCsv,
    publicBaseUrl: options.publicBaseUrl,
    audioPrefix: options.audioPrefix
  });

  if (['1', 'true', 'yes'].includes(String(process.env.FMA_PURGE_DEEZER || '').toLowerCase())) {
    await store.deletePlaylistsBySourceProvider('deezer');
    await store.deleteTracksBySourceProvider('deezer');
  }

  const imported = await store.upsertImportedTracks(tracks, options.importedByUserId || null);
  return {
    total: imported.length,
    tracks: imported
  };
}

async function hydrate(req) {
  const user = getCurrentUser(req);
  const [authors, tracksRaw, playlists] = await Promise.all([
    store.readAuthors(),
    store.readTracksRaw(),
    store.readPlaylistsRaw()
  ]);

  const normalizedTracks = tracksRaw.map(normalizeTrack);
  const authorById = Object.fromEntries(authors.map(author => [author.id, author]));

  const tracks = normalizedTracks
    .filter(track => isTrackVisibleToUser(track, user))
    .map(track => ({
      ...track,
      artist: authorById[track.artistId]?.name || 'Unknown'
    }));

  return {
    authors,
    authorById,
    playlists,
    tracks,
    tracksRaw: normalizedTracks,
    user
  };
}

async function performRegister(req, payload) {
  const email = store.normalizeEmail(payload.email || '');
  const displayName = String(payload.displayName || '').trim();
  const password = String(payload.password || '');
  const password2 = String(payload.password2 || '');

  if (!email || !email.includes('@') || email.length < 5) {
    throw new Error('Введите корректный email');
  }

  if (!password || password.length < 6) {
    throw new Error('Пароль должен быть минимум 6 символов');
  }

  if (password !== password2) {
    throw new Error('Пароли не совпадают');
  }

  if (await store.findUserByEmailAnyProvider(email)) {
    throw new Error('Пользователь с таким email уже существует');
  }

  const user = await store.createLocalUser({
    id: `u_${crypto.randomBytes(8).toString('hex')}`,
    email,
    displayName: displayName || email.split('@')[0] || 'User',
    passwordHash: hashPassword(password)
  });

  await persistUserSession(req, user.id);
  return user;
}

async function performLogin(req, payload) {
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');
  const user = await store.findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Неверный email или пароль');
  }

  await persistUserSession(req, user.id);
  return user;
}

async function performDemoLogin(req, kind) {
  const id = {
    admin: 'u_admin',
    artist: 'u_artist',
    user: 'u_user'
  }[kind];

  if (!id) throw new Error('Неизвестный демо-аккаунт');

  const user = await store.findUserById(id);
  if (!user) throw new Error('Демо-аккаунт не найден');

  await persistUserSession(req, user.id);
  return user;
}

async function createArtistUploadTrack(req) {
  const user = getCurrentUser(req);
  if (!user?.artistId) throw new Error('У аккаунта нет artistId');

  const title = String(req.body.title || '').trim();
  const genre = String(req.body.genre || '').trim() || 'Unknown';
  const duration = String(req.body.duration || '').trim() || '0:00';

  if (!title) throw new Error('Название трека обязательно');

  const audioFile = req.files?.audio?.[0];
  const coverFile = req.files?.cover?.[0];
  const audio = audioFile ? `/uploads/audio/${audioFile.filename}` : '/audio/sample.wav';
  const cover = coverFile ? `/uploads/covers/${coverFile.filename}` : '/assets/covers/default.png';

  return store.createTrack({
    id: newTrackId(),
    title,
    artistId: user.artistId,
    genre,
    duration,
    cover,
    audio,
    plays: 0,
    likes: 0,
    status: 'pending',
    submittedBy: user.id
  });
}

function canManagePlaylist(user, playlist) {
  if (!user || !playlist) return false;
  if (user.role === 'admin') return true;
  return Boolean(playlist.ownerUserId && playlist.ownerUserId === user.id);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));
app.use(express.static(CLIENT_DIST_DIR));

app.use(
  session({
    store: new PgSessionStore({
      pool: getPool(),
      tableName: 'session',
      createTableIfMissing: false
    }),
    secret: process.env.SESSION_SECRET || 'soundhub_dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

app.use(
  asyncHandler(async (req, res, next) => {
    const userId = req.session?.userId;
    const user = userId ? await store.findUserById(userId) : null;

    req.currentUser = user;
    res.locals.currentUser = user;
    res.locals.isAuthenticated = !!user;
    res.locals.effectiveLikes = user ? await store.getUserLikes(user.id) : getGuestLikes(req);
    res.locals.providers = {
      google: providerConfigured('google'),
      vk: providerConfigured('vk'),
      yandex: providerConfigured('yandex')
    };

    next();
  })
);

const ALLOWED_AUDIO = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac']);
const ALLOWED_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'audio') return cb(null, UPLOAD_AUDIO_DIR);
      if (file.fieldname === 'cover') return cb(null, UPLOAD_COVER_DIR);
      return cb(null, path.join(PUBLIC_DIR, 'uploads'));
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').toLowerCase();
      const safeExt = ext && ext.length <= 10 ? ext : '';
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
      cb(null, name);
    }
  }),
  limits: {
    fileSize: 30 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (file.fieldname === 'audio' && ext && !ALLOWED_AUDIO.has(ext)) {
      return cb(new Error('Аудио: поддерживаются mp3/wav/ogg/m4a/aac'));
    }
    if (file.fieldname === 'cover' && ext && !ALLOWED_IMAGE.has(ext)) {
      return cb(new Error('Обложка: поддерживаются png/jpg/jpeg/webp'));
    }
    cb(null, true);
  }
});

const artistUploadFields = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);

app.get(
  '/media/artwork/:kind/:provider/:id.svg',
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind || 'track');
    const provider = String(req.params.provider || 'fma');
    const sourceId = String(req.params.id || '');

    let title = 'SoundHub';
    let subtitle = kind === 'artist' ? 'Исполнитель' : 'Трек';
    let seed = `${kind}:${provider}:${sourceId}`;

    if (kind === 'track') {
      const track = await store.findTrackBySource(provider, sourceId);
      if (track) {
        title = track.title || title;
        subtitle = track.albumTitle || track.genre || subtitle;
        seed = track.id || seed;
      }
    }

    const svg = buildArtworkSvg({ title, subtitle, seed });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(svg);
  })
);

app.get(
  '/media/tracks/:id/stream',
  asyncHandler(async (req, res) => {
    const track = await store.findTrackById(req.params.id);
    const user = getCurrentUser(req);

    if (!track) return res.status(404).json({ ok: false, error: 'Track not found' });
    if (!isTrackVisibleToUser(track, user)) {
      return res.status(403).json({ ok: false, error: 'Track is not available' });
    }

    const normalizedTrack = normalizeTrack(track);
    let absPath;
    let contentType = normalizedTrack.audioMimeType || 'audio/mpeg';

    try {
      absPath = await ensureTrackAudioCache(normalizedTrack);
    } catch (error) {
      if (!fs.existsSync(SAMPLE_AUDIO_PATH)) throw error;
      console.warn(`Fallback audio for track ${track.id}: ${error.message || error}`);
      absPath = SAMPLE_AUDIO_PATH;
      contentType = 'audio/wav';
    }

    sendFileWithRange(req, res, absPath, contentType);
  })
);

app.get(
  '/api/bootstrap',
  asyncHandler(async (req, res) => {
    const { playlists, tracks, authorById, user } = await hydrate(req);
    const liked = res.locals.effectiveLikes || [];
    const decorated = decorateTracks(tracks, authorById, liked);
    const trackMap = Object.fromEntries(decorated.map(track => [track.id, track]));

    res.json({
      ok: true,
      user: serializeViewer(user),
      likes: liked,
      providers: res.locals.providers,
      roles: {
        canAdmin: user?.role === 'admin',
        canUpload: user?.role === 'artist'
      },
      catalog: {
        provider: 'fma',
        subset: process.env.FMA_SUBSET || null,
        canSync: user?.role === 'admin'
      },
      playlistOptions: playlists.map(playlist => buildPlaylistPreview(playlist, trackMap))
    });
  })
);

app.get(
  '/api/home',
  asyncHandler(async (req, res) => {
    const { authors, tracks, playlists, authorById } = await hydrate(req);
    const liked = res.locals.effectiveLikes || [];
    const decorated = decorateTracks(tracks, authorById, liked);
    const trackMap = Object.fromEntries(decorated.map(track => [track.id, track]));
    const topTracks = [...decorated].sort((a, b) => b.plays - a.plays).slice(0, 8);
    const newTracks = [...decorated]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 8);
    const featuredTracks = [...decorated]
      .sort((a, b) => (b.plays + b.likes * 8) - (a.plays + a.likes * 8))
      .slice(0, 8);

    res.json({
      ok: true,
      topTracks,
      newTracks,
      featuredTracks,
      playlists: playlists.map(playlist => buildPlaylistPreview(playlist, trackMap)),
      authors: authors.slice(0, 12),
      liveCharts: featuredTracks
    });
  })
);

app.get(
  '/api/playlists',
  asyncHandler(async (req, res) => {
    const { playlists, tracks, authorById } = await hydrate(req);
    const liked = res.locals.effectiveLikes || [];
    const decorated = decorateTracks(tracks, authorById, liked);
    const trackMap = Object.fromEntries(decorated.map(track => [track.id, track]));

    res.json({
      ok: true,
      playlists: playlists.map(playlist => buildPlaylistPreview(playlist, trackMap))
    });
  })
);

app.get(
  '/api/playlists/:id',
  asyncHandler(async (req, res) => {
    const { playlists, tracks, authorById } = await hydrate(req);
    const playlist = playlists.find(item => item.id === req.params.id);
    if (!playlist) return res.status(404).json({ ok: false, error: 'Playlist not found' });

    const liked = res.locals.effectiveLikes || [];
    const decorated = decorateTracks(tracks, authorById, liked);
    const trackMap = Object.fromEntries(decorated.map(track => [track.id, track]));
    const items = (playlist.trackIds || []).map(id => trackMap[id]).filter(Boolean);

    res.json({
      ok: true,
      playlist: buildPlaylistPreview(playlist, trackMap),
      items
    });
  })
);

app.post(
  '/api/playlists',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Нужен аккаунт для создания плейлиста' });

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'Название плейлиста обязательно' });

    const playlist = await store.createPlaylist({
      title,
      description: description || null,
      ownerName: user.displayName || 'User',
      ownerUserId: user.id,
      cover: '/assets/covers/default.png',
      trackIds: []
    });

    res.json({ ok: true, playlist });
  })
);

app.post(
  '/api/playlists/:id/tracks',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    const playlist = await store.findPlaylistById(req.params.id);
    if (!playlist) return res.status(404).json({ ok: false, error: 'Playlist not found' });
    if (!canManagePlaylist(user, playlist)) {
      return res.status(403).json({ ok: false, error: 'Нельзя редактировать этот плейлист' });
    }

    const trackId = String(req.body.trackId || '').trim();
    if (!trackId) return res.status(400).json({ ok: false, error: 'trackId обязателен' });

    const updated = await store.addTrackToPlaylist(playlist.id, trackId);
    if (!updated) return res.status(404).json({ ok: false, error: 'Track not found' });
    res.json({ ok: true, playlist: updated });
  })
);

app.delete(
  '/api/playlists/:id/tracks/:trackId',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    const playlist = await store.findPlaylistById(req.params.id);
    if (!playlist) return res.status(404).json({ ok: false, error: 'Playlist not found' });
    if (!canManagePlaylist(user, playlist)) {
      return res.status(403).json({ ok: false, error: 'Нельзя редактировать этот плейлист' });
    }

    const updated = await store.removeTrackFromPlaylist(playlist.id, req.params.trackId);
    res.json({ ok: true, playlist: updated });
  })
);

app.delete(
  '/api/playlists/:id',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    const playlist = await store.findPlaylistById(req.params.id);
    if (!playlist) return res.status(404).json({ ok: false, error: 'Playlist not found' });
    if (!canManagePlaylist(user, playlist)) {
      return res.status(403).json({ ok: false, error: 'Нельзя удалить этот плейлист' });
    }

    await store.deletePlaylist(playlist.id);
    res.json({ ok: true });
  })
);

app.get(
  '/api/authors/:id',
  asyncHandler(async (req, res) => {
    const { authorById, tracks } = await hydrate(req);
    const author = authorById[req.params.id];
    if (!author) return res.status(404).json({ ok: false, error: 'Author not found' });

    const liked = res.locals.effectiveLikes || [];
    const authorTracks = decorateTracks(
      tracks.filter(track => track.artistId === author.id),
      authorById,
      liked
    );

    res.json({
      ok: true,
      author,
      tracks: authorTracks,
      stats: {
        tracks: authorTracks.length,
        followers: author.stats?.followers || 0,
        plays: authorTracks.reduce((sum, track) => sum + Number(track.plays || 0), 0)
      }
    });
  })
);

app.get(
  '/api/tracks/:id',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    let track = await store.findTrackById(req.params.id);
    if (!track) return res.status(404).json({ ok: false, error: 'Track not found' });

    track = normalizeTrack(track);
    if (!isTrackVisibleToUser(track, user)) {
      return res.status(403).json({ ok: false, error: 'Track is not available' });
    }

    const { authorById, tracks } = await hydrate(req);
    const liked = res.locals.effectiveLikes || [];
    const decoratedTrack = decorateTrack(track, authorById, liked);
    const related = decorateTracks(
      tracks
        .filter(item => item.id !== track.id)
        .sort((left, right) => {
          const leftScore =
            (left.artistId === track.artistId ? 120 : 0) +
            (left.genre === track.genre ? 60 : 0) +
            Number(left.plays || 0);
          const rightScore =
            (right.artistId === track.artistId ? 120 : 0) +
            (right.genre === track.genre ? 60 : 0) +
            Number(right.plays || 0);
          return rightScore - leftScore;
        })
        .slice(0, 6),
      authorById,
      liked
    );

    res.json({
      ok: true,
      track: decoratedTrack,
      author: authorById[decoratedTrack.artistId] || null,
      related
    });
  })
);

app.get(
  '/api/search',
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || '').trim();
    const liked = res.locals.effectiveLikes || [];
    const { authorById, tracks } = await hydrate(req);

    const localResults = query
      ? decorateTracks(await store.searchTracks(query, 24), authorById, liked)
      : decorateTracks(tracks.slice(0, 12), authorById, liked);
    const excludeIds = new Set(localResults.map(track => track.id));
    const discoveries = decorateTracks(
      [...tracks]
        .filter(track => !excludeIds.has(track.id))
        .sort((a, b) => (b.plays + b.likes * 8) - (a.plays + a.likes * 8))
        .slice(0, 12),
      authorById,
      liked
    );

    res.json({
      ok: true,
      query,
      localResults,
      discoveries,
      charts: discoveries,
      externalResults: []
    });
  })
);

app.get(
  '/api/library',
  asyncHandler(async (req, res) => {
    const likedIds = res.locals.effectiveLikes || [];
    const { tracks, playlists, authorById, user } = await hydrate(req);
    const likedSet = new Set(likedIds);
    const likedTracks = decorateTracks(
      tracks.filter(track => likedSet.has(track.id)),
      authorById,
      likedIds
    );

    res.json({
      ok: true,
      user: serializeViewer(user),
      likedTracks,
      playlists: playlists.filter(playlist => !user || playlist.ownerUserId === user.id || user.role === 'admin')
    });
  })
);

app.get(
  '/api/profile',
  asyncHandler(async (req, res) => {
    const user = getCurrentUser(req);
    const { playlists } = await hydrate(req);

    res.json({
      ok: true,
      user: serializeViewer(user),
      playlists: user ? playlists.filter(playlist => playlist.ownerUserId === user.id) : []
    });
  })
);

app.get(
  '/api/admin',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const { tracks, playlists, authorById } = await hydrate(req);
    const liked = res.locals.effectiveLikes || [];
    const decorated = decorateTracks(tracks, authorById, liked);

    res.json({
      ok: true,
      pending: decorated.filter(track => (track.status || 'published') === 'pending'),
      rejected: decorated.filter(track => (track.status || 'published') === 'rejected'),
      published: decorated.filter(track => (track.status || 'published') === 'published'),
      playlists
    });
  })
);

app.post(
  '/api/catalog/sync',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const limit = Math.max(0, Number(req.body.limit || process.env.FMA_IMPORT_LIMIT || 0));
    const payload = await syncFmaCatalog({
      limit: limit || undefined,
      importedByUserId: getCurrentUser(req)?.id || null
    });

    res.json({
      ok: true,
      total: payload.total,
      tracks: payload.tracks.slice(0, 12)
    });
  })
);

app.post(
  '/api/session/register',
  asyncHandler(async (req, res) => {
    try {
      const user = await performRegister(req, req.body || {});
      res.json({ ok: true, user: serializeViewer(user) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Регистрация не удалась' });
    }
  })
);

app.post(
  '/api/session/login',
  asyncHandler(async (req, res) => {
    try {
      const user = await performLogin(req, req.body || {});
      res.json({ ok: true, user: serializeViewer(user) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Вход не удался' });
    }
  })
);

app.post('/api/session/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post(
  '/api/artist/upload',
  requireRoleJson('artist'),
  (req, res, next) => {
    artistUploadFields(req, res, err => {
      if (err) return res.status(400).json({ ok: false, error: err.message || 'Ошибка загрузки файла' });
      next();
    });
  },
  asyncHandler(async (req, res) => {
    try {
      const track = await createArtistUploadTrack(req);
      res.json({ ok: true, track });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Не удалось загрузить трек' });
    }
  })
);

app.post(
  '/api/admin/tracks/:id/approve',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const updated = await store.updateTrackStatus(req.params.id, 'published', getCurrentUser(req)?.id);
    if (!updated) return res.status(404).json({ ok: false, error: 'Track not found' });
    res.json({ ok: true, track: updated });
  })
);

app.post(
  '/api/admin/tracks/:id/reject',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const updated = await store.updateTrackStatus(req.params.id, 'rejected', getCurrentUser(req)?.id);
    if (!updated) return res.status(404).json({ ok: false, error: 'Track not found' });
    res.json({ ok: true, track: updated });
  })
);

app.delete(
  '/api/admin/tracks/:id',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const removed = await store.deleteTrack(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Track not found' });

    deleteManagedUpload(removed.audio);
    deleteManagedUpload(removed.cover);
    res.json({ ok: true, track: removed });
  })
);

app.delete(
  '/api/admin/playlists/:id',
  requireRoleJson('admin'),
  asyncHandler(async (req, res) => {
    const deleted = await store.deletePlaylist(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Playlist not found' });
    res.json({ ok: true });
  })
);

app.post(
  '/register',
  asyncHandler(async (req, res) => {
    const nextUrl = sanitizeNextUrl(req.body.next || '/');
    try {
      await performRegister(req, req.body || {});
      return res.redirect(nextUrl);
    } catch (error) {
      return res.redirect(
        `/register?error=${encodeURIComponent(error.message || 'Ошибка регистрации')}&next=${encodeURIComponent(
          nextUrl
        )}&email=${encodeURIComponent(req.body.email || '')}&name=${encodeURIComponent(req.body.displayName || '')}`
      );
    }
  })
);

app.post(
  '/login',
  asyncHandler(async (req, res) => {
    const nextUrl = sanitizeNextUrl(req.body.next || '/');
    try {
      await performLogin(req, req.body || {});
      return res.redirect(nextUrl);
    } catch (error) {
      return res.redirect(
        `/login?error=${encodeURIComponent(error.message || 'Ошибка входа')}&next=${encodeURIComponent(nextUrl)}`
      );
    }
  })
);

app.get(
  '/login/demo/:kind',
  asyncHandler(async (req, res) => {
    const nextUrl = sanitizeNextUrl(req.query.next || '/');

    try {
      await performDemoLogin(req, req.params.kind);
      return res.redirect(nextUrl);
    } catch (error) {
      return res.redirect(`/login?error=${encodeURIComponent(error.message || 'Ошибка демо-входа')}`);
    }
  })
);

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.post(
  '/artist/upload',
  requireRole('artist'),
  (req, res, next) => {
    artistUploadFields(req, res, err => {
      if (err) {
        const message = err.message || 'Ошибка загрузки файла';
        return res.redirect(`/artist/upload?error=${encodeURIComponent(message)}`);
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    try {
      await createArtistUploadTrack(req);
      return res.redirect(`/artist/upload?success=${encodeURIComponent('Трек отправлен на модерацию')}`);
    } catch (error) {
      return res.redirect(`/artist/upload?error=${encodeURIComponent(error.message || 'Ошибка загрузки')}`);
    }
  })
);

app.post(
  '/admin/tracks/:id/approve',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const updated = await store.updateTrackStatus(req.params.id, 'published', getCurrentUser(req)?.id);
    if (!updated) return res.status(404).send('Track not found');
    return res.redirect('/admin');
  })
);

app.post(
  '/admin/tracks/:id/reject',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const updated = await store.updateTrackStatus(req.params.id, 'rejected', getCurrentUser(req)?.id);
    if (!updated) return res.status(404).send('Track not found');
    return res.redirect('/admin');
  })
);

app.post(
  '/admin/tracks/:id/delete',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const removed = await store.deleteTrack(req.params.id);
    if (!removed) return res.status(404).send('Track not found');

    deleteManagedUpload(removed.audio);
    deleteManagedUpload(removed.cover);
    return res.redirect('/admin');
  })
);

app.post(
  '/admin/playlists/:id/delete',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const deleted = await store.deletePlaylist(req.params.id);
    if (!deleted) return res.status(404).send('Playlist not found');
    return res.redirect('/admin');
  })
);

app.get('/auth/google', (req, res) => {
  if (!providerConfigured('google')) return res.status(500).send('Google OAuth не настроен');
  const state = crypto.randomBytes(16).toString('hex');
  setOauthState(req, 'google', state);
  setOauthNext(req, 'google', req.query.next || '/');
  const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get(
  '/auth/google/callback',
  asyncHandler(async (req, res) => {
    if (!checkOauthState(req, 'google', req.query.state)) return res.status(400).send('Bad state');
    const code = req.query.code;
    if (!code) return res.status(400).send('No code');

    const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(500).send(`Google token error: ${JSON.stringify(tokenJson)}`);
    }

    const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenJson.access_token}` }
    });
    const me = await meRes.json();
    if (!meRes.ok) return res.status(500).send(`Google userinfo error: ${JSON.stringify(me)}`);

    const user = await store.upsertOauthUser({
      provider: 'google',
      providerId: me.sub,
      email: me.email,
      displayName: me.name || me.email,
      avatar: me.picture
    });

    await persistUserSession(req, user.id);
    return res.redirect(consumeOauthNext(req, 'google'));
  })
);

app.get('/auth/yandex', (req, res) => {
  if (!providerConfigured('yandex')) return res.status(500).send('Yandex OAuth не настроен');
  const state = crypto.randomBytes(16).toString('hex');
  setOauthState(req, 'yandex', state);
  setOauthNext(req, 'yandex', req.query.next || '/');
  const redirectUri = `${getBaseUrl(req)}/auth/yandex/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.YANDEX_CLIENT_ID,
    redirect_uri: redirectUri,
    state
  });
  res.redirect(`https://oauth.yandex.ru/authorize?${params.toString()}`);
});

app.get(
  '/auth/yandex/callback',
  asyncHandler(async (req, res) => {
    if (!checkOauthState(req, 'yandex', req.query.state)) return res.status(400).send('Bad state');
    const code = req.query.code;
    if (!code) return res.status(400).send('No code');

    const redirectUri = `${getBaseUrl(req)}/auth/yandex/callback`;
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: process.env.YANDEX_CLIENT_ID,
        client_secret: process.env.YANDEX_CLIENT_SECRET,
        redirect_uri: redirectUri
      })
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) return res.status(500).send(`Yandex token error: ${JSON.stringify(tokenJson)}`);

    const meRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { authorization: `OAuth ${tokenJson.access_token}` }
    });
    const me = await meRes.json();
    if (!meRes.ok) return res.status(500).send(`Yandex userinfo error: ${JSON.stringify(me)}`);

    const user = await store.upsertOauthUser({
      provider: 'yandex',
      providerId: me.id,
      email: me.default_email,
      displayName: me.display_name || me.real_name || me.default_email,
      avatar: me.default_avatar_id
        ? `https://avatars.yandex.net/get-yapic/${me.default_avatar_id}/islands-200`
        : null
    });

    await persistUserSession(req, user.id);
    return res.redirect(consumeOauthNext(req, 'yandex'));
  })
);

app.get('/auth/vk', (req, res) => {
  if (!providerConfigured('vk')) return res.status(500).send('VK OAuth не настроен');
  const state = crypto.randomBytes(16).toString('hex');
  setOauthState(req, 'vk', state);
  setOauthNext(req, 'vk', req.query.next || '/');
  const redirectUri = `${getBaseUrl(req)}/auth/vk/callback`;

  const params = new URLSearchParams({
    client_id: process.env.VK_CLIENT_ID,
    redirect_uri: redirectUri,
    display: 'page',
    scope: 'email',
    response_type: 'code',
    v: '5.131',
    state
  });
  res.redirect(`https://oauth.vk.com/authorize?${params.toString()}`);
});

app.get(
  '/auth/vk/callback',
  asyncHandler(async (req, res) => {
    if (!checkOauthState(req, 'vk', req.query.state)) return res.status(400).send('Bad state');
    const code = req.query.code;
    if (!code) return res.status(400).send('No code');

    const redirectUri = `${getBaseUrl(req)}/auth/vk/callback`;
    const tokenParams = new URLSearchParams({
      client_id: process.env.VK_CLIENT_ID,
      client_secret: process.env.VK_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: String(code)
    });
    const tokenRes = await fetch(`https://oauth.vk.com/access_token?${tokenParams.toString()}`);
    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || tokenJson.error) {
      return res.status(500).send(`VK token error: ${JSON.stringify(tokenJson)}`);
    }

    const profileRes = await fetch(
      `https://api.vk.com/method/users.get?${new URLSearchParams({
        user_ids: String(tokenJson.user_id),
        fields: 'photo_200',
        access_token: tokenJson.access_token,
        v: '5.131'
      }).toString()}`
    );
    const profileJson = await profileRes.json();
    if (!profileRes.ok || profileJson.error) {
      return res.status(500).send(`VK profile error: ${JSON.stringify(profileJson)}`);
    }

    const profile = (profileJson.response && profileJson.response[0]) || {};
    const displayName =
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || tokenJson.email || 'VK User';
    const user = await store.upsertOauthUser({
      provider: 'vk',
      providerId: tokenJson.user_id,
      email: tokenJson.email || null,
      displayName,
      avatar: profile.photo_200 || null
    });

    await persistUserSession(req, user.id);
    return res.redirect(consumeOauthNext(req, 'vk'));
  })
);

app.post(
  '/api/like/:trackId',
  asyncHandler(async (req, res) => {
    const trackId = req.params.trackId;
    const user = getCurrentUser(req);
    const track = await store.findTrackById(trackId);

    if (!track) return res.status(404).json({ ok: false, error: 'Track not found' });
    if (!isTrackVisibleToUser(track, user)) {
      return res.status(403).json({ ok: false, error: 'Track is not available' });
    }

    if (user) {
      const result = await store.toggleTrackLike(user.id, trackId);
      return res.json({
        ok: true,
        liked: result.liked,
        likes: result.likes
      });
    }

    const guest = new Set(getGuestLikes(req));
    let liked;
    if (guest.has(trackId)) {
      guest.delete(trackId);
      liked = false;
    } else {
      guest.add(trackId);
      liked = true;
    }

    req.session.guestLikes = Array.from(guest);
    return res.json({
      ok: true,
      liked,
      likes: req.session.guestLikes,
      guest: true
    });
  })
);

app.post(
  '/api/play/:trackId',
  asyncHandler(async (req, res) => {
    const trackId = req.params.trackId;
    const user = getCurrentUser(req);
    const track = await store.findTrackById(trackId);

    if (!track) return res.status(404).json({ ok: false, error: 'Track not found' });
    if (!isTrackVisibleToUser(track, user)) {
      return res.status(403).json({ ok: false, error: 'Track is not available' });
    }

    const plays = await store.incrementTrackPlay(trackId, {
      userId: user?.id || null,
      sessionId: req.sessionID || null
    });

    return res.json({
      ok: true,
      trackId: track.id,
      plays
    });
  })
);

app.get('/api/me', (req, res) => {
  const user = getCurrentUser(req);
  return res.json({
    ok: true,
    user: serializeViewer(user),
    likes: res.locals.effectiveLikes || []
  });
});

app.get('/artist/upload', requireRole('artist'), (req, res) => sendClientApp(res));
app.get('/admin', requireRole('admin'), (req, res) => sendClientApp(res));
app.get(
  [
    '/',
    '/playlists',
    '/playlist/:id',
    '/author/:id',
    '/track/:id',
    '/search',
    '/library',
    '/profile',
    '/login',
    '/register'
  ],
  (req, res) => sendClientApp(res)
);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'API route not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);

  if (req.path.startsWith('/api/')) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'Internal Server Error'
    });
  }

  res.status(500).send(err?.stack || err?.toString() || 'Internal Server Error');
});

const server = app.listen(PORT, () => {
  console.log(`SoundHub running on http://localhost:${PORT}`);
});

server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or run with PORT=<other-port>.`);
    process.exit(1);
  }

  if (error?.code === 'EACCES') {
    console.error(`Port ${PORT} requires elevated permissions. Use a port above 1024.`);
    process.exit(1);
  }

  throw error;
});
