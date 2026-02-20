const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');

// Optional .env support (doesn't break if you don't use it)
try {
  require('dotenv').config();
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares -------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'soundhub_dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    }
  })
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

// --- Files & folders ---------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LIKES_FILE = path.join(DATA_DIR, 'user_likes.json');
const AUTHORS_FILE = path.join(DATA_DIR, 'authors.json');
const TRACKS_FILE = path.join(DATA_DIR, 'tracks.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');

const UPLOAD_AUDIO_DIR = path.join(__dirname, 'public', 'uploads', 'audio');
const UPLOAD_COVER_DIR = path.join(__dirname, 'public', 'uploads', 'covers');

function ensureDir(absPath) {
  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch (_) {}
}

ensureDir(UPLOAD_AUDIO_DIR);
ensureDir(UPLOAD_COVER_DIR);

// --- JSON helpers ------------------------------------------------------------
function safeReadJsonFile(absPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeWriteJsonFile(absPath, data) {
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf8');
}

// --- Password helpers --------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  // timingSafeEqual requires buffers of the same length
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Simple file-based auth storage (demo) ----------------------------------
function ensureAuthFiles() {
  if (!fs.existsSync(USERS_FILE)) {
    const users = [
      {
        id: 'u_admin',
        provider: 'local',
        email: 'admin@soundhub.local',
        displayName: 'Админ',
        role: 'admin',
        passwordHash: hashPassword('admin123')
      },
      {
        id: 'u_artist',
        provider: 'local',
        email: 'artist@soundhub.local',
        displayName: 'Исполнитель',
        role: 'artist',
        artistId: 'a1',
        passwordHash: hashPassword('artist123')
      },
      {
        id: 'u_user',
        provider: 'local',
        email: 'user@soundhub.local',
        displayName: 'Пользователь',
        role: 'user',
        passwordHash: hashPassword('user123')
      }
    ];
    safeWriteJsonFile(USERS_FILE, users);
  }
  if (!fs.existsSync(LIKES_FILE)) {
    safeWriteJsonFile(LIKES_FILE, {
      u_admin: [],
      u_artist: [],
      u_user: []
    });
  }
}

ensureAuthFiles();

let USERS = safeReadJsonFile(USERS_FILE, []);
let USER_LIKES = safeReadJsonFile(LIKES_FILE, {});

function saveUsers() {
  safeWriteJsonFile(USERS_FILE, USERS);
}

function saveUserLikes() {
  safeWriteJsonFile(LIKES_FILE, USER_LIKES);
}

function findUserById(id) {
  return USERS.find(u => u.id === id) || null;
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function findUserByEmail(email) {
  const e = normalizeEmail(email);
  return USERS.find(u => u.provider === 'local' && normalizeEmail(u.email) === e) || null;
}

function findUserByEmailAnyProvider(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return USERS.find(u => normalizeEmail(u.email) === e) || null;
}

function upsertOauthUser({ provider, providerId, email, displayName, avatar }) {
  const pid = String(providerId);

  // 1) Existing direct OAuth user
  const existing = USERS.find(u =>
    (u.provider === provider && String(u.providerId) === pid) ||
    (u.oauthLinks && u.oauthLinks[provider] && String(u.oauthLinks[provider].providerId) === pid)
  );
  if (existing) {
    existing.email = email || existing.email;
    existing.displayName = displayName || existing.displayName;
    existing.avatar = avatar || existing.avatar;

    // Keep a link record even if this user was originally "provider-only"
    existing.oauthLinks = existing.oauthLinks || {};
    existing.oauthLinks[provider] = existing.oauthLinks[provider] || { providerId: pid };
    existing.oauthLinks[provider].providerId = pid;
    if (email) existing.oauthLinks[provider].email = email;
    if (avatar) existing.oauthLinks[provider].avatar = avatar;
    existing.oauthLinks[provider].lastLoginAt = new Date().toISOString();
    existing.oauthLinks[provider].linkedAt = existing.oauthLinks[provider].linkedAt || new Date().toISOString();

    saveUsers();
    return existing;
  }

  // 2) If we have an email, try to link OAuth to an existing account with the same email
  const normEmail = normalizeEmail(email);
  if (normEmail) {
    const byEmail = findUserByEmailAnyProvider(normEmail);
    if (byEmail) {
      byEmail.oauthLinks = byEmail.oauthLinks || {};
      byEmail.oauthLinks[provider] = {
        providerId: pid,
        email: email || byEmail.email || null,
        avatar: avatar || byEmail.avatar || null,
        linkedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };

      // Enrich profile (optional)
      byEmail.email = byEmail.email || email || null;
      byEmail.displayName = byEmail.displayName || displayName || byEmail.displayName;
      byEmail.avatar = byEmail.avatar || avatar || byEmail.avatar;

      USER_LIKES[byEmail.id] = USER_LIKES[byEmail.id] || [];
      saveUsers();
      saveUserLikes();
      return byEmail;
    }
  }

  // 3) Create a new user
  const id = `u_${crypto.randomBytes(8).toString('hex')}`;
  const user = {
    id,
    provider,
    providerId: pid,
    email: email || null,
    displayName: displayName || 'User',
    avatar: avatar || null,
    role: 'user',
    passwordHash: null,
    oauthLinks: {
      [provider]: {
        providerId: pid,
        email: email || null,
        avatar: avatar || null,
        linkedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      }
    },
    createdAt: new Date().toISOString()
  };
  USERS.push(user);
  USER_LIKES[id] = USER_LIKES[id] || [];
  saveUsers();
  saveUserLikes();
  return user;
}


function getCurrentUser(req) {
  const id = req.session?.userId;
  if (!id) return null;
  return findUserById(id);
}

function getGuestLikes(req) {
  if (!req.session) return [];
  if (!Array.isArray(req.session.guestLikes)) req.session.guestLikes = [];
  return req.session.guestLikes;
}

function getUserLikes(userId) {
  return Array.isArray(USER_LIKES[userId]) ? USER_LIKES[userId] : [];
}

function setUserLikes(userId, likes) {
  USER_LIKES[userId] = likes;
  saveUserLikes();
}

function getEffectiveLikes(req) {
  const user = getCurrentUser(req);
  if (user) return getUserLikes(user.id);
  return getGuestLikes(req);
}

function mergeGuestLikesIntoUser(req, userId) {
  const guestLikes = getGuestLikes(req);
  if (!guestLikes.length) return;
  const current = new Set(getUserLikes(userId));
  for (const t of guestLikes) current.add(t);
  setUserLikes(userId, Array.from(current));
  req.session.guestLikes = [];
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

// --- OAuth helpers -----------------------------------------------------------
function providerConfigured(provider) {
  const env = process.env;
  if (provider === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (provider === 'vk') return !!(env.VK_CLIENT_ID && env.VK_CLIENT_SECRET);
  if (provider === 'yandex') return !!(env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET);
  return false;
}

function getBaseUrl(req) {
  // Prefer explicit BASE_URL (recommended for OAuth), otherwise fall back to request headers
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
  const n = String(nextUrl || '/');
  if (!n.startsWith('/') || n.startsWith('//')) return '/';
  return n;
}

function setOauthNext(req, provider, nextUrl) {
  if (!req.session) return;
  if (!req.session.oauthNext) req.session.oauthNext = {};
  req.session.oauthNext[provider] = sanitizeNextUrl(nextUrl);
}

function consumeOauthNext(req, provider) {
  const n = req.session?.oauthNext?.[provider];
  if (req.session?.oauthNext) delete req.session.oauthNext[provider];
  return sanitizeNextUrl(n || '/');
}


// Expose auth info to templates on every request
app.use((req, res, next) => {
  const user = getCurrentUser(req);
  res.locals.currentUser = user;
  res.locals.isAuthenticated = !!user;
  res.locals.effectiveLikes = getEffectiveLikes(req);
  res.locals.providers = {
    google: providerConfigured('google'),
    vk: providerConfigured('vk'),
    yandex: providerConfigured('yandex')
  };
  next();
});

// --- Uploads (artist adds tracks) -------------------------------------------
const ALLOWED_AUDIO = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac']);
const ALLOWED_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'audio') return cb(null, UPLOAD_AUDIO_DIR);
      if (file.fieldname === 'cover') return cb(null, UPLOAD_COVER_DIR);
      return cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').toLowerCase();
      const safeExt = ext && ext.length <= 10 ? ext : '';
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
      cb(null, name);
    }
  }),
  limits: {
    // keep it reasonable for a university demo
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

// --- Data (tracks/playlists) ------------------------------------------------
function readAuthors() {
  return safeReadJsonFile(AUTHORS_FILE, []);
}

function readTracksRaw() {
  return safeReadJsonFile(TRACKS_FILE, []);
}

function writeTracksRaw(tracks) {
  safeWriteJsonFile(TRACKS_FILE, tracks);
}

function readPlaylistsRaw() {
  return safeReadJsonFile(PLAYLISTS_FILE, []);
}

function writePlaylistsRaw(playlists) {
  safeWriteJsonFile(PLAYLISTS_FILE, playlists);
}

function normalizeTrack(t) {
  const n = { ...t };

  // Backward compatibility with old demo format
  if (!n.status) {
    if (n.published === false) n.status = 'pending';
    else n.status = 'published';
  }

  if (!n.cover) n.cover = '/assets/covers/default.png';
  if (!n.audio) n.audio = '/audio/sample.wav';
  if (!n.duration) n.duration = '0:00';
  if (!Number.isFinite(Number(n.plays))) n.plays = 0;
  if (!Number.isFinite(Number(n.likes))) n.likes = 0;

  return n;
}

function isTrackVisibleToUser(track, user) {
  const status = track.status || 'published';
  if (status === 'published') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'artist' && user.artistId && track.artistId === user.artistId) return true;
  return false;
}

function canModerateTrack(user, track) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // artists can manage only their own (for future расширений)
  if (user.role === 'artist' && user.artistId && track.artistId === user.artistId) return true;
  return false;
}

function hydrate(req) {
  const user = getCurrentUser(req);
  const authors = readAuthors();
  const tracksRaw = readTracksRaw().map(normalizeTrack);
  const playlists = readPlaylistsRaw();

  const authorById = Object.fromEntries(authors.map(a => [a.id, a]));

  const tracksHydrated = tracksRaw
    .filter(t => isTrackVisibleToUser(t, user))
    .map(t => ({
      ...t,
      artist: authorById[t.artistId]?.name || 'Unknown'
    }));

  return { authors, tracks: tracksHydrated, playlists, authorById, tracksRaw, user };
}

function withLikeFlag(tracks, likedIds) {
  const set = new Set(likedIds || []);
  return tracks.map(t => ({ ...t, isLiked: set.has(t.id) }));
}

function renderWithLayout(res, view, params) {
  res.render(view, params, (err, html) => {
    if (err) return res.status(500).send(err.toString());
    res.render('partials/layout', { ...params, body: html });
  });
}

function newTrackId() {
  return `t_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

// --- Pages -------------------------------------------------------------------
app.get('/', (req, res) => {
  const { tracks } = hydrate(req);
  const liked = res.locals.effectiveLikes || [];

  // Only published are visible for guests/users, so this stays clean automatically
  const topTracks = withLikeFlag(
    [...tracks].sort((a, b) => b.plays - a.plays).slice(0, 4),
    liked
  );
  const newTracks = withLikeFlag([...tracks].slice(0, 3), liked);

  renderWithLayout(res, 'home', {
    title: 'Главная',
    headline: 'SoundHub',
    subline: 'Слушай треки, ставь лайки и собирай библиотеку.',
    topTracks,
    newTracks
  });
});

app.get('/playlists', (req, res) => {
  const { playlists, tracks } = hydrate(req);
  const trackSet = new Set(tracks.map(t => t.id));

  const list = playlists.map(p => ({
    ...p,
    visibleCount: Array.isArray(p.trackIds) ? p.trackIds.filter(id => trackSet.has(id)).length : 0
  }));

  renderWithLayout(res, 'playlists', {
    title: 'Подборки',
    headline: 'Подборки',
    subline: list.length ? 'Редакционные и пользовательские плейлисты.' : null,
    playlists: list
  });
});

app.get('/playlist/:id', (req, res) => {
  const { tracks, playlists } = hydrate(req);
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).send('Playlist not found');
  const liked = res.locals.effectiveLikes || [];

  const items = withLikeFlag(
    (playlist.trackIds || []).map(id => tracks.find(t => t.id === id)).filter(Boolean),
    liked
  );

  const totalCount = (playlist.trackIds || []).length;
  const visibleCount = items.length;
  const hiddenSuffix = visibleCount < totalCount ? ` • скрыто: ${totalCount - visibleCount}` : '';

  renderWithLayout(res, 'playlist', {
    title: playlist.title,
    headline: playlist.title,
    subline: `${visibleCount} треков${hiddenSuffix}${playlist.total ? ` • ${playlist.total}` : ''}`,
    playlist,
    items
  });
});

app.get('/author/:id', (req, res) => {
  const { authorById, tracks, user } = hydrate(req);
  const author = authorById[req.params.id];
  if (!author) return res.status(404).send('Author not found');

  const liked = res.locals.effectiveLikes || [];
  const authorTracksRaw = tracks.filter(t => t.artistId === author.id);
  const authorTracks = withLikeFlag(authorTracksRaw, liked);

  const showStatus =
    !!user && (user.role === 'admin' || (user.role === 'artist' && user.artistId === author.id));

  const stats = {
    tracks: authorTracksRaw.length,
    followers: author?.stats?.followers ?? 0,
    plays: authorTracksRaw.reduce((sum, t) => sum + Number(t.plays || 0), 0)
  };

  renderWithLayout(res, 'author', {
    title: author.name,
    headline: author.name,
    subline: author.tagline,
    author,
    tracks: authorTracks,
    stats,
    showStatus
  });
});

app.get('/track/:id', (req, res) => {
  const user = getCurrentUser(req);
  const authors = readAuthors();
  const authorById = Object.fromEntries(authors.map(a => [a.id, a]));

  const allTracks = readTracksRaw().map(normalizeTrack);
  const trackRaw = allTracks.find(t => t.id === req.params.id);
  if (!trackRaw) return res.status(404).send('Track not found');

  if (!isTrackVisibleToUser(trackRaw, user)) {
    // Hide unpublished tracks from public
    return res.status(404).send('Track not found');
  }

  const track = {
    ...trackRaw,
    artist: authorById[trackRaw.artistId]?.name || 'Unknown'
  };

  const author = authorById[track.artistId];
  const { tracks: visibleTracks } = hydrate(req);

  const liked = res.locals.effectiveLikes || [];
  const related = withLikeFlag(
    visibleTracks.filter(t => t.id !== track.id).slice(0, 4),
    liked
  );
  const trackWithLike = withLikeFlag([track], liked)[0];

  const showStatus =
    !!user && (user.role === 'admin' || (user.role === 'artist' && user.artistId === track.artistId));

  renderWithLayout(res, 'track', {
    title: track.title,
    headline: track.title,
    subline: `${author?.name || 'Unknown'} • ${track.genre}`,
    track: trackWithLike,
    author,
    related,
    showStatus
  });
});

// --- Artist: upload track ----------------------------------------------------
app.get('/artist/upload', requireRole('artist'), (req, res) => {
  const user = getCurrentUser(req);
  renderWithLayout(res, 'artist_upload', {
    title: 'Добавить трек',
    headline: 'Добавить трек',
    subline: 'Трек попадёт в очередь модерации и станет доступен всем после одобрения админом.',
    error: req.query.error || null,
    success: req.query.success || null,
    artistId: user?.artistId || null
  });
});

const artistUploadFields = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);

app.post('/artist/upload', requireRole('artist'), (req, res, next) => {
  artistUploadFields(req, res, err => {
    if (err) {
      const msg = err.message || 'Ошибка загрузки файла';
      return res.redirect(`/artist/upload?error=${encodeURIComponent(msg)}`);
    }
    next();
  });
}, (req, res) => {
  const user = getCurrentUser(req);
  if (!user?.artistId) return res.status(400).send('У аккаунта нет artistId');

  const title = String(req.body.title || '').trim();
  const genre = String(req.body.genre || '').trim() || 'Unknown';
  const duration = String(req.body.duration || '').trim() || '0:00';

  if (!title) {
    return res.redirect(`/artist/upload?error=${encodeURIComponent('Название трека обязательно')}`);
  }

  const audioFile = req.files?.audio?.[0];
  const coverFile = req.files?.cover?.[0];

  const audio = audioFile ? `/uploads/audio/${audioFile.filename}` : '/audio/sample.wav';
  const cover = coverFile ? `/uploads/covers/${coverFile.filename}` : '/assets/covers/default.png';

  const tracks = readTracksRaw().map(normalizeTrack);
  const id = newTrackId();

  const newTrack = {
    id,
    title,
    artistId: user.artistId,
    genre,
    duration,
    cover,
    audio,
    plays: 0,
    likes: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    submittedBy: user.id
  };

  tracks.unshift(newTrack);
  writeTracksRaw(tracks);

  return res.redirect(`/artist/upload?success=${encodeURIComponent('Трек отправлен на модерацию')}`);
});

// --- Admin: moderation + playlists ------------------------------------------
app.get('/admin', requireRole('admin'), (req, res) => {
  const { tracks, playlists } = hydrate(req);

  const pending = tracks.filter(t => (t.status || 'published') === 'pending');
  const rejected = tracks.filter(t => (t.status || 'published') === 'rejected');

  renderWithLayout(res, 'admin', {
    title: 'Админ',
    headline: 'Админ-панель',
    subline: 'Модерация треков и управление подборками.',
    pending,
    rejected,
    playlists
  });
});

app.post('/admin/tracks/:id/approve', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const tracks = readTracksRaw().map(normalizeTrack);
  const t = tracks.find(x => x.id === id);
  if (!t) return res.status(404).send('Track not found');

  t.status = 'published';
  t.publishedAt = new Date().toISOString();
  writeTracksRaw(tracks);

  return res.redirect('/admin');
});

app.post('/admin/tracks/:id/reject', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const tracks = readTracksRaw().map(normalizeTrack);
  const t = tracks.find(x => x.id === id);
  if (!t) return res.status(404).send('Track not found');

  t.status = 'rejected';
  t.rejectedAt = new Date().toISOString();
  writeTracksRaw(tracks);

  return res.redirect('/admin');
});

app.post('/admin/tracks/:id/delete', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const tracks = readTracksRaw().map(normalizeTrack);
  const next = tracks.filter(x => x.id !== id);
  writeTracksRaw(next);

  // Also remove from playlists
  const playlists = readPlaylistsRaw();
  const updated = playlists.map(p => ({
    ...p,
    trackIds: Array.isArray(p.trackIds) ? p.trackIds.filter(tid => tid !== id) : []
  }));
  writePlaylistsRaw(updated);

  return res.redirect('/admin');
});

app.post('/admin/playlists/:id/delete', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const playlists = readPlaylistsRaw();
  const next = playlists.filter(p => p.id !== id);
  writePlaylistsRaw(next);
  return res.redirect('/admin');
});

// --- Search -----------------------------------------------------------------
app.get('/search', (req, res) => {
  const { tracks } = hydrate(req);
  const liked = res.locals.effectiveLikes || [];
  renderWithLayout(res, 'search', {
    title: 'Обзор',
    headline: 'Обзор и поиск',
    subline: 'Поиск по трекам и авторам.',
    results: withLikeFlag(tracks, liked)
  });
});

// --- Library (liked tracks) --------------------------------------------------
app.get('/library', (req, res) => {
  const { tracks } = hydrate(req);
  const likedIds = res.locals.effectiveLikes || [];
  const likedSet = new Set(likedIds);
  const likedTracks = withLikeFlag(tracks.filter(t => likedSet.has(t.id)), likedIds);

  const user = getCurrentUser(req);
  const headline = 'Библиотека';
  const subline = user
    ? `Лайкнутые треки • ${likedTracks.length}`
    : `Гостевой режим • лайков: ${likedTracks.length}`;

  renderWithLayout(res, 'library', {
    title: 'Библиотека',
    headline,
    subline,
    likedTracks
  });
});

// --- Profile ----------------------------------------------------------------
app.get('/profile', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return renderWithLayout(res, 'profile', {
      title: 'Профиль',
      headline: 'Гость',
      subline: 'Вход необязателен — можно пользоваться как гость.',
      user: null
    });
  }

  renderWithLayout(res, 'profile', {
    title: 'Профиль',
    headline: user.displayName || 'Профиль',
    subline: null,
    user
  });
});

// --- Auth: local -------------------------------------------------------------
app.get('/register', (req, res) => {
  renderWithLayout(res, 'register', {
    title: 'Регистрация',
    headline: 'Регистрация',
    subline: 'Можно зарегистрироваться или продолжить как гость.',
    next: sanitizeNextUrl(req.query.next || '/'),
    error: req.query.error || null,
    email: req.query.email || '',
    displayName: req.query.name || ''
  });
});

app.post('/register', (req, res) => {
  const nextUrl = sanitizeNextUrl(req.body.next || '/');
  const email = normalizeEmail(req.body.email || '');
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  if (!email || !email.includes('@') || email.length < 5) {
    return res.redirect(
      `/register?error=${encodeURIComponent('Введите корректный email')}&next=${encodeURIComponent(nextUrl)}`
    );
  }

  if (!password || password.length < 6) {
    return res.redirect(
      `/register?error=${encodeURIComponent('Пароль должен быть минимум 6 символов')}&next=${encodeURIComponent(
        nextUrl
      )}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(displayName)}`
    );
  }

  if (password !== password2) {
    return res.redirect(
      `/register?error=${encodeURIComponent('Пароли не совпадают')}&next=${encodeURIComponent(
        nextUrl
      )}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(displayName)}`
    );
  }

  if (findUserByEmailAnyProvider(email)) {
    return res.redirect(
      `/register?error=${encodeURIComponent('Пользователь с таким email уже существует')}&next=${encodeURIComponent(
        nextUrl
      )}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(displayName)}`
    );
  }

  const id = `u_${crypto.randomBytes(8).toString('hex')}`;
  const user = {
    id,
    provider: 'local',
    email,
    displayName: displayName || email.split('@')[0] || 'User',
    role: 'user',
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  USERS.push(user);
  USER_LIKES[id] = USER_LIKES[id] || [];
  saveUsers();
  saveUserLikes();

  req.session.userId = id;
  mergeGuestLikesIntoUser(req, id);
  return res.redirect(nextUrl);
});

app.get('/login', (req, res) => {
  renderWithLayout(res, 'login', {
    title: 'Вход',
    headline: 'Вход в аккаунт',
    subline: 'Вход необязателен — можно продолжить как гость.',
    next: sanitizeNextUrl(req.query.next || '/'),
    error: req.query.error || null
  });
});

app.post('/login', (req, res) => {
  const nextUrl = sanitizeNextUrl(req.body.next || '/');
  const email = (req.body.email || '').trim();
  const password = String(req.body.password || '');
  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.redirect(
      `/login?error=${encodeURIComponent('Неверный email или пароль')}&next=${encodeURIComponent(nextUrl)}`
    );
  }

  req.session.userId = user.id;
  mergeGuestLikesIntoUser(req, user.id);
  return res.redirect(nextUrl);
});

app.get('/login/demo/:kind', (req, res) => {
  const nextUrl = sanitizeNextUrl(req.query.next || '/');
  const kind = req.params.kind;
  const map = {
    admin: 'u_admin',
    artist: 'u_artist',
    user: 'u_user'
  };
  const id = map[kind];
  if (!id) return res.redirect(`/login?error=${encodeURIComponent('Неизвестный демо-аккаунт')}`);
  req.session.userId = id;
  mergeGuestLikesIntoUser(req, id);
  return res.redirect(nextUrl);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// --- Auth: OAuth (VK / Yandex / Google) -------------------------------------
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

app.get('/auth/google/callback', async (req, res) => {
  try {
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

    const accessToken = tokenJson.access_token;
    const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const me = await meRes.json();
    if (!meRes.ok) return res.status(500).send(`Google userinfo error: ${JSON.stringify(me)}`);

    const user = upsertOauthUser({
      provider: 'google',
      providerId: me.sub,
      email: me.email,
      displayName: me.name || me.email,
      avatar: me.picture
    });
    req.session.userId = user.id;
    mergeGuestLikesIntoUser(req, user.id);
    return res.redirect(consumeOauthNext(req, 'google'));
  } catch (e) {
    return res.status(500).send(e?.stack || e?.toString() || 'OAuth error');
  }
});

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

app.get('/auth/yandex/callback', async (req, res) => {
  try {
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

    const accessToken = tokenJson.access_token;
    const meRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { authorization: `OAuth ${accessToken}` }
    });
    const me = await meRes.json();
    if (!meRes.ok) return res.status(500).send(`Yandex userinfo error: ${JSON.stringify(me)}`);

    const user = upsertOauthUser({
      provider: 'yandex',
      providerId: me.id,
      email: me.default_email,
      displayName: me.display_name || me.real_name || me.default_email,
      avatar: me.default_avatar_id
        ? `https://avatars.yandex.net/get-yapic/${me.default_avatar_id}/islands-200`
        : null
    });
    req.session.userId = user.id;
    mergeGuestLikesIntoUser(req, user.id);
    return res.redirect(consumeOauthNext(req, 'yandex'));
  } catch (e) {
    return res.status(500).send(e?.stack || e?.toString() || 'OAuth error');
  }
});

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

app.get('/auth/vk/callback', async (req, res) => {
  try {
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
    if (!tokenRes.ok || tokenJson.error)
      return res.status(500).send(`VK token error: ${JSON.stringify(tokenJson)}`);

    const accessToken = tokenJson.access_token;
    const userId = tokenJson.user_id;
    const email = tokenJson.email || null;
    const profileRes = await fetch(
      `https://api.vk.com/method/users.get?${new URLSearchParams({
        user_ids: String(userId),
        fields: 'photo_200',
        access_token: accessToken,
        v: '5.131'
      }).toString()}`
    );
    const profileJson = await profileRes.json();
    if (!profileRes.ok || profileJson.error)
      return res.status(500).send(`VK profile error: ${JSON.stringify(profileJson)}`);

    const p = (profileJson.response && profileJson.response[0]) || {};
    const displayName = [p.first_name, p.last_name].filter(Boolean).join(' ') || email || 'VK User';
    const user = upsertOauthUser({
      provider: 'vk',
      providerId: userId,
      email,
      displayName,
      avatar: p.photo_200 || null
    });
    req.session.userId = user.id;
    mergeGuestLikesIntoUser(req, user.id);
    return res.redirect(consumeOauthNext(req, 'vk'));
  } catch (e) {
    return res.status(500).send(e?.stack || e?.toString() || 'OAuth error');
  }
});

// --- API: like/unlike --------------------------------------------------------
app.post('/api/like/:trackId', (req, res) => {
  const trackId = req.params.trackId;
  const user = getCurrentUser(req);

  const allTracks = readTracksRaw().map(normalizeTrack);
  const track = allTracks.find(t => t.id === trackId);
  if (!track) return res.status(404).json({ ok: false, error: 'Track not found' });

  // Don't allow liking hidden tracks for guests/regular users
  if (!isTrackVisibleToUser(track, user)) {
    return res.status(403).json({ ok: false, error: 'Track is not available' });
  }

  if (user) {
    const current = new Set(getUserLikes(user.id));
    let liked;
    if (current.has(trackId)) {
      current.delete(trackId);
      liked = false;
    } else {
      current.add(trackId);
      liked = true;
    }
    setUserLikes(user.id, Array.from(current));
    return res.json({ ok: true, liked, likes: getUserLikes(user.id) });
  }

  // Guest
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
  return res.json({ ok: true, liked, likes: req.session.guestLikes, guest: true });
});

app.get('/api/me', (req, res) => {
  const user = getCurrentUser(req);
  return res.json({
    ok: true,
    user: user
      ? {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          provider: user.provider
        }
      : null,
    likes: getEffectiveLikes(req)
  });
});

app.listen(PORT, () => {
  console.log(`SoundHub running on http://localhost:${PORT}`);
});
