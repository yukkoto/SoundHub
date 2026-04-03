const crypto = require('crypto');

const DEFAULT_BASE_URLS = [];

const PREPARE_ID_KEYS = [
  'song_id',
  'songId',
  'id',
  'track_id',
  'trackId',
  'video_id',
  'videoId',
  'resource_id',
  'resourceId'
];

const DETAIL_ARRAY_KEYS = ['results', 'songs', 'tracks', 'items', 'data'];
const DETAIL_OBJECT_KEYS = ['result', 'song', 'track', 'item', 'data', 'payload'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hashValue(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function normalizeText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.trim();
}

function firstText(source, keys) {
  if (!isPlainObject(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      const flattened = value.map(normalizeText).filter(Boolean).join(', ');
      if (flattened) return flattened;
      continue;
    }
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function firstUrl(...values) {
  for (const value of values.flat()) {
    const text = normalizeText(value);
    if (/^https?:\/\//i.test(text)) return text;
  }
  return '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function secondsToDurationText(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function durationTextToSeconds(value) {
  const raw = normalizeText(value);
  if (!raw) return 0;
  const parts = raw.split(':').map(part => Number(part));
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0] || 0);
}

function pickDurationSeconds(detail) {
  if (!isPlainObject(detail)) return 0;

  const msKeys = ['duration_ms', 'durationMs', 'length_ms', 'lengthMs'];
  for (const key of msKeys) {
    const value = Number(detail[key]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value / 1000);
  }

  const secondKeys = ['duration_seconds', 'durationSeconds', 'length_seconds', 'lengthSeconds'];
  for (const key of secondKeys) {
    const value = Number(detail[key]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }

  const durationText =
    firstText(detail, ['duration_text', 'durationText', 'duration', 'length']) ||
    firstText(detail.track || null, ['duration', 'length']);
  const parsedFromText = durationTextToSeconds(durationText);
  if (parsedFromText > 0) return parsedFromText;

  const numericDuration = Number(detail.duration);
  if (Number.isFinite(numericDuration) && numericDuration > 0) {
    if (numericDuration > 7200) return Math.floor(numericDuration / 1000);
    return Math.floor(numericDuration);
  }

  return 0;
}

function guessAudioMimeType(url) {
  const value = normalizeText(url).toLowerCase();
  if (value.endsWith('.wav')) return 'audio/wav';
  if (value.endsWith('.ogg')) return 'audio/ogg';
  if (value.endsWith('.aac')) return 'audio/aac';
  if (value.endsWith('.m4a') || value.endsWith('.mp4')) return 'audio/mp4';
  if (value.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function toBaseUrls() {
  const envUrls = unique(
    `${process.env.MUSICAPI_BASE_URLS || ''},${process.env.MUSICAPI_BASE_URL || ''}`
      .split(',')
      .map(item => item.trim().replace(/\/$/, ''))
  );

  return envUrls.length ? envUrls : DEFAULT_BASE_URLS;
}

function buildApiUrl(baseUrl, endpoint) {
  return new URL(endpoint.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function buildAudioUrl(baseUrl, remoteSongId) {
  if (!remoteSongId) return '';
  return buildApiUrl(baseUrl, `audio/${encodeURIComponent(remoteSongId)}`);
}

async function requestMusicApi(baseUrl, endpoint, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildApiUrl(baseUrl, endpoint), {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.1'
      }
    });

    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = text.trim();
      }
    }

    if (!response.ok) {
      throw new Error(
        (isPlainObject(payload) && (payload.error || payload.message)) ||
          `MusicAPI ответил со статусом ${response.status}`
      );
    }

    if (isPlainObject(payload) && payload.ok === false) {
      throw new Error(payload.error || payload.message || 'MusicAPI вернул ошибку');
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function collectCandidateIds(payload, bucket = []) {
  if (!payload) return bucket;

  if (typeof payload === 'string' || typeof payload === 'number') {
    const text = normalizeText(payload);
    if (text) bucket.push(text);
    return bucket;
  }

  if (Array.isArray(payload)) {
    payload.forEach(item => collectCandidateIds(item, bucket));
    return bucket;
  }

  if (!isPlainObject(payload)) return bucket;

  for (const key of PREPARE_ID_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = normalizeText(value);
      if (text) bucket.push(text);
    }
  }

  for (const key of DETAIL_ARRAY_KEYS.concat(DETAIL_OBJECT_KEYS)) {
    if (payload[key]) collectCandidateIds(payload[key], bucket);
  }

  return bucket;
}

function hasTrackLikeShape(value) {
  if (!isPlainObject(value)) return false;

  const textKeys = [
    'title',
    'song_name',
    'songName',
    'name',
    'artist',
    'artist_name',
    'artistName',
    'audio_url',
    'audioUrl',
    'download_url',
    'downloadUrl',
    'youtube_url',
    'youtubeUrl',
    'spotify_url',
    'spotifyUrl'
  ];

  return textKeys.some(key => normalizeText(value[key]));
}

function collectDetailObjects(payload, bucket = [], seen = new Set()) {
  if (!payload) return bucket;

  if (Array.isArray(payload)) {
    payload.forEach(item => collectDetailObjects(item, bucket, seen));
    return bucket;
  }

  if (!isPlainObject(payload)) return bucket;

  if (hasTrackLikeShape(payload)) {
    const signature = JSON.stringify(payload);
    if (!seen.has(signature)) {
      seen.add(signature);
      bucket.push(payload);
    }
  }

  for (const key of DETAIL_ARRAY_KEYS) {
    if (payload[key]) collectDetailObjects(payload[key], bucket, seen);
  }

  for (const key of DETAIL_OBJECT_KEYS) {
    if (payload[key]) collectDetailObjects(payload[key], bucket, seen);
  }

  return bucket;
}

function sanitizeExternalId(value, fallbackSeed) {
  const raw = normalizeText(value);
  if (!raw) return `id_${hashValue(fallbackSeed).slice(0, 16)}`;
  if (/^[a-z0-9._-]+$/i.test(raw)) return raw;
  return `id_${hashValue(raw).slice(0, 16)}`;
}

function inferArtistId(detail, artistName, remoteSongId) {
  const explicitId = firstText(detail, ['artist_id', 'artistId', 'channel_id', 'channelId']);
  return sanitizeExternalId(explicitId || artistName || remoteSongId, explicitId || artistName || remoteSongId);
}

function normalizeTrackDetail(detail, { baseUrl, fallbackQuery, preparedSongId }) {
  const remoteSongId = firstText(detail, PREPARE_ID_KEYS) || preparedSongId || '';
  const nestedTrack = isPlainObject(detail.track) ? detail.track : null;
  const nestedArtist = isPlainObject(detail.artist) ? detail.artist : null;
  const nestedAlbum = isPlainObject(detail.album) ? detail.album : null;

  const title =
    firstText(detail, ['title', 'song_name', 'songName', 'name']) ||
    firstText(nestedTrack, ['title', 'name']) ||
    fallbackQuery;
  const artistName =
    firstText(detail, ['artist_name', 'artistName', 'artist', 'author', 'channel', 'uploader']) ||
    firstText(nestedArtist, ['name', 'title']) ||
    'MusicAPI';
  const albumTitle =
    firstText(detail, ['album_title', 'albumTitle', 'album_name']) ||
    firstText(nestedAlbum, ['name', 'title']) ||
    null;

  let youtubeUrl = firstUrl(
    detail.youtube_url,
    detail.youtubeUrl,
    detail.yt_url,
    detail.ytUrl,
    detail.source_url,
    detail.sourceUrl,
    nestedTrack?.youtube_url,
    nestedTrack?.youtubeUrl
  );
  let spotifyUrl = firstUrl(
    detail.spotify_url,
    detail.spotifyUrl,
    detail.spotify_link,
    detail.spotifyLink,
    nestedTrack?.spotify_url,
    nestedTrack?.spotifyUrl
  );
  const sourceUrl = firstUrl(
    detail.source_url,
    detail.sourceUrl,
    detail.page_url,
    detail.pageUrl,
    youtubeUrl,
    spotifyUrl
  );

  if (!youtubeUrl && /youtube\.com|youtu\.be/i.test(sourceUrl)) youtubeUrl = sourceUrl;
  if (!spotifyUrl && /spotify\.com/i.test(sourceUrl)) spotifyUrl = sourceUrl;

  const cover = firstUrl(
    detail.cover_url,
    detail.coverUrl,
    detail.thumbnail_url,
    detail.thumbnailUrl,
    detail.thumbnail,
    detail.thumb,
    detail.image,
    nestedAlbum?.image,
    nestedTrack?.thumbnail_url
  );

  const directAudioUrl = firstUrl(
    detail.audio_url,
    detail.audioUrl,
    detail.download_url,
    detail.downloadUrl,
    detail.stream_url,
    detail.streamUrl,
    detail.preview_url,
    detail.previewUrl
  );
  const originStorageUrl = directAudioUrl || buildAudioUrl(baseUrl, remoteSongId);
  const durationSeconds = pickDurationSeconds(detail);
  const durationText =
    firstText(detail, ['duration_text', 'durationText']) ||
    (durationSeconds ? secondsToDurationText(durationSeconds) : '0:00');

  if (!title || !originStorageUrl) return null;

  return {
    sourceProvider: 'musicapi',
    sourceTrackId: sanitizeExternalId(remoteSongId || sourceUrl || title, remoteSongId || sourceUrl || title),
    sourceArtistId: inferArtistId(detail, artistName, remoteSongId || sourceUrl || title),
    title,
    artistName,
    artistAvatar: cover || '/assets/covers/default.png',
    artistFollowers: 0,
    artistSourceUrl: spotifyUrl || youtubeUrl || null,
    genre: firstText(detail, ['genre', 'category']) || 'Музыка',
    durationSeconds,
    durationText,
    cover: cover || '/assets/covers/default.png',
    audioUrl: originStorageUrl,
    preview: directAudioUrl || originStorageUrl,
    sourceUrl: sourceUrl || youtubeUrl || spotifyUrl || null,
    albumTitle,
    explicitLyrics: Boolean(detail.explicit_lyrics || detail.explicit || detail.isExplicit),
    payload: {
      provider: 'musicapi',
      query: fallbackQuery,
      remoteSongId: remoteSongId || null,
      sourceBaseUrl: baseUrl,
      youtubeUrl: youtubeUrl || null,
      spotifyUrl: spotifyUrl || null,
      audioUrl: originStorageUrl,
      albumTitle,
      artistName
    },
    sourceDataset: 'musicapi',
    originStorageUrl,
    storageObjectKey: null,
    cacheFilePath: null,
    audioMimeType: guessAudioMimeType(originStorageUrl)
  };
}

async function resolveTracks(queryOrUrl, options = {}) {
  const query = normalizeText(queryOrUrl);
  if (!query) return [];

  const limit = Math.max(1, Number(options.limit || process.env.MUSICAPI_RESULT_LIMIT || 1));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.MUSICAPI_TIMEOUT_MS || 8000));
  const errors = [];

  for (const baseUrl of toBaseUrls()) {
    try {
      const prepared = await requestMusicApi(baseUrl, `prepare/${encodeURIComponent(query)}`, timeoutMs);
      const preparedDetails = collectDetailObjects(prepared)
        .map(detail => normalizeTrackDetail(detail, { baseUrl, fallbackQuery: query }))
        .filter(Boolean);

      if (preparedDetails.length) return preparedDetails.slice(0, limit);

      const preparedSongIds = unique(collectCandidateIds(prepared)).slice(0, limit);
      if (!preparedSongIds.length) {
        throw new Error('MusicAPI не вернул идентификатор трека');
      }

      const tracks = [];
      for (const preparedSongId of preparedSongIds) {
        const fetched = await requestMusicApi(baseUrl, `fetch/${encodeURIComponent(preparedSongId)}`, timeoutMs);
        const detailObjects = collectDetailObjects(fetched);
        const normalized = (detailObjects.length ? detailObjects : [fetched])
          .map(detail => normalizeTrackDetail(detail, { baseUrl, fallbackQuery: query, preparedSongId }))
          .filter(Boolean);

        if (normalized.length) tracks.push(...normalized);
      }

      if (tracks.length) {
        return unique(tracks.map(track => JSON.stringify(track))).map(item => JSON.parse(item)).slice(0, limit);
      }
    } catch (error) {
      errors.push(`${baseUrl}: ${error.message || error}`);
    }
  }

  if (errors.length) {
    throw new Error(errors[errors.length - 1]);
  }

  return [];
}

module.exports = {
  buildAudioUrl,
  resolveTracks,
  toBaseUrls
};
