const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DEFAULT_TRACKS_CSV = path.join(process.cwd(), 'data', 'fma', 'tracks.csv');
const DEFAULT_GENRES_CSV = path.join(process.cwd(), 'data', 'fma', 'genres.csv');

function normalizeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/\d+/);
  return match ? String(Number(match[0])) : null;
}

function padTrackId(trackId) {
  return String(normalizeId(trackId) || '').padStart(6, '0');
}

function toDurationText(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeHeaderToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseNumber(value, fallback = 0) {
  const num = Number(String(value || '').trim());
  return Number.isFinite(num) ? num : fallback;
}

function ensureTrailingSlash(value) {
  return String(value || '').endsWith('/') ? String(value || '') : `${String(value || '')}/`;
}

function buildAudioRelativePath(trackId) {
  const padded = padTrackId(trackId);
  return `${padded.slice(0, 3)}/${padded}.mp3`;
}

function buildStorageKey(trackId, prefix = process.env.FMA_AUDIO_PREFIX || 'fma_small') {
  const relativePath = buildAudioRelativePath(trackId);
  const cleanPrefix = String(prefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  return cleanPrefix ? `${cleanPrefix}/${relativePath}` : relativePath;
}

function buildLocalAudioPath(baseDir, trackId) {
  if (!baseDir) return null;
  return path.join(baseDir, buildAudioRelativePath(trackId));
}

function buildRemoteAudioUrl(trackId, options = {}) {
  const baseUrl = options.publicBaseUrl || process.env.VK_S3_PUBLIC_BASE_URL || '';
  if (!String(baseUrl).trim()) return null;
  return new URL(buildStorageKey(trackId, options.audioPrefix), ensureTrailingSlash(baseUrl)).toString();
}

function buildProxyTrackId(trackId, provider = 'fma') {
  const normalized = normalizeId(trackId);
  return normalized ? `t_${provider}_${normalized}` : null;
}

function buildTrackStreamUrl(trackId, provider = 'fma') {
  const proxyTrackId = buildProxyTrackId(trackId, provider);
  return proxyTrackId ? `/media/tracks/${proxyTrackId}/stream` : null;
}

function buildTrackArtworkUrl(trackId, provider = 'fma') {
  const normalized = normalizeId(trackId);
  return normalized ? `/media/artwork/track/${provider}/${normalized}.svg` : '/assets/covers/default.png';
}

function buildArtistArtworkUrl(artistId, provider = 'fma') {
  const normalized = normalizeId(artistId);
  return normalized ? `/media/artwork/artist/${provider}/${normalized}.svg` : '/assets/covers/default.png';
}

function parseMultiHeaderCsv(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const rows = parse(raw, {
    bom: true,
    skip_empty_lines: false,
    relax_column_count: true
  });

  if (rows.length < 3) {
    throw new Error(`Invalid FMA metadata file: ${absPath}`);
  }

  const sectionRow = rows[0];
  const fieldRow = rows[1];
  const records = [];

  for (const row of rows.slice(2)) {
    if (!row || !row.length) continue;
    const entry = {};

    for (let index = 0; index < row.length; index += 1) {
      if (index === 0) {
        entry.id = String(row[index] || '').trim();
        continue;
      }

      const section = normalizeHeaderToken(sectionRow[index]);
      const field = normalizeHeaderToken(fieldRow[index]);
      const key = [section, field].filter(Boolean).join('.');
      if (!key) continue;
      entry[key] = row[index];
    }

    if (entry.id) records.push(entry);
  }

  return records;
}

function parseGenresCsv(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return new Map();

  const raw = fs.readFileSync(absPath, 'utf8');
  const rows = parse(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true
  });

  const map = new Map();
  for (const row of rows) {
    const id = normalizeId(row.genre_id || row.id);
    const title = String(row.title || row.name || '').trim();
    if (id && title) map.set(id, title);
  }

  return map;
}

function parseGenreList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const matches = raw.match(/\d+/g);
  return matches ? matches.map(item => String(Number(item))) : [];
}

function pickGenre(record, genresById) {
  const topGenre = String(record['track.genre_top'] || '').trim();
  if (topGenre) return topGenre;

  const list = parseGenreList(record['track.genres_all'] || record['track.genres']);
  for (const id of list) {
    if (genresById.has(id)) return genresById.get(id);
  }

  return 'Музыка';
}

function filterTrackRecord(record, options = {}) {
  const subset = String(options.subset || process.env.FMA_SUBSET || '').trim().toLowerCase();
  const recordSubset = String(record['set.subset'] || '').trim().toLowerCase();
  if (subset && recordSubset && subset !== recordSubset) return false;

  const title = String(record['track.title'] || '').trim();
  const artistName = String(record['artist.name'] || '').trim();
  if (!title || !artistName) return false;

  return true;
}

function normalizeTrackRecord(record, genresById, options = {}) {
  const sourceTrackId = normalizeId(record.id);
  if (!sourceTrackId) return null;

  const sourceArtistId =
    normalizeId(record['artist.id']) ||
    normalizeId(record['track.artist_id']) ||
    normalizeId(record['artist.handle']) ||
    sourceTrackId;
  const sourceAlbumId =
    normalizeId(record['album.id']) ||
    normalizeId(record['track.album_id']) ||
    null;
  const durationSeconds = parseNumber(record['track.duration'], 0);
  const plays = parseNumber(record['track.listens'], 0);
  const favorites = parseNumber(record['track.favorites'], 0);
  const subset = String(record['set.subset'] || options.subset || process.env.FMA_SUBSET || '').trim() || null;
  const artistName = String(record['artist.name'] || '').trim() || 'Unknown Artist';
  const sourcePayload = {
    subset,
    license: String(record['track.license'] || '').trim() || null,
    interest: parseNumber(record['track.interest'], 0),
    listens: plays,
    favorites,
    raw: record
  };

  return {
    sourceProvider: 'fma',
    sourceTrackId,
    sourceArtistId: String(sourceArtistId),
    sourceAlbumId: sourceAlbumId ? String(sourceAlbumId) : null,
    sourceUrl: null,
    title: String(record['track.title'] || '').trim(),
    artistName,
    artistAvatar: buildArtistArtworkUrl(sourceArtistId),
    artistFollowers: parseNumber(record['artist.favorites'], 0),
    artistSourceUrl: null,
    albumTitle: String(record['album.title'] || '').trim() || null,
    cover: buildTrackArtworkUrl(sourceTrackId),
    audioUrl: buildTrackStreamUrl(sourceTrackId),
    preview: null,
    durationSeconds,
    durationText: toDurationText(durationSeconds),
    explicitLyrics: false,
    plays,
    likes: favorites,
    genre: pickGenre(record, genresById),
    payload: sourcePayload,
    sourceDataset: subset,
    storageObjectKey: buildStorageKey(sourceTrackId, options.audioPrefix),
    originStorageUrl: buildRemoteAudioUrl(sourceTrackId, options),
    audioMimeType: 'audio/mpeg',
    cacheFilePath: null
  };
}

function sortCatalogTracks(a, b) {
  const byPlays = Number(b.plays || 0) - Number(a.plays || 0);
  if (byPlays !== 0) return byPlays;
  return Number(a.sourceTrackId || 0) - Number(b.sourceTrackId || 0);
}

function loadCatalogTracks(options = {}) {
  const tracksCsv = options.tracksCsv || process.env.FMA_TRACKS_CSV || DEFAULT_TRACKS_CSV;
  const genresCsv = options.genresCsv || process.env.FMA_GENRES_CSV || DEFAULT_GENRES_CSV;

  if (!fs.existsSync(tracksCsv)) {
    throw new Error(`FMA tracks.csv not found: ${tracksCsv}`);
  }

  const genresById = parseGenresCsv(genresCsv);
  const rows = parseMultiHeaderCsv(tracksCsv);
  const limit = Number(options.limit || process.env.FMA_IMPORT_LIMIT || 0);

  const tracks = rows
    .filter(row => filterTrackRecord(row, options))
    .map(row => normalizeTrackRecord(row, genresById, options))
    .filter(Boolean)
    .sort(sortCatalogTracks);

  return limit > 0 ? tracks.slice(0, limit) : tracks;
}

module.exports = {
  buildAudioRelativePath,
  buildLocalAudioPath,
  buildProxyTrackId,
  buildRemoteAudioUrl,
  buildStorageKey,
  buildTrackArtworkUrl,
  buildTrackStreamUrl,
  loadCatalogTracks,
  normalizeId,
  normalizeTrackRecord,
  padTrackId,
  toDurationText
};
