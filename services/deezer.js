const crypto = require('crypto');

function normalizeText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.trim();
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

function hashValue(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function firstUrl(...values) {
  for (const value of values.flat()) {
    const text = normalizeText(value);
    if (/^https?:\/\//i.test(text)) return text;
  }
  return '';
}

function sanitizeId(value, fallbackSeed) {
  const raw = normalizeText(value);
  if (!raw) return `id_${hashValue(fallbackSeed).slice(0, 16)}`;
  if (/^[a-z0-9._-]+$/i.test(raw)) return raw;
  return `id_${hashValue(raw).slice(0, 16)}`;
}

function normalizeTrack(item) {
  const id = sanitizeId(item?.id, `${item?.artist?.name || ''}:${item?.title || ''}`);
  const artistId = sanitizeId(item?.artist?.id, item?.artist?.name || id);
  const durationSeconds = Math.max(0, Number(item?.duration || 0));
  const previewUrl = firstUrl(item?.preview);
  const coverUrl = firstUrl(
    item?.album?.cover_xl,
    item?.album?.cover_big,
    item?.album?.cover_medium,
    item?.album?.cover,
    item?.artist?.picture_xl,
    item?.artist?.picture_big,
    item?.artist?.picture_medium
  );
  const sourceUrl = firstUrl(item?.link);
  const artistUrl = firstUrl(item?.artist?.link);

  if (!id || !previewUrl) return null;

  return {
    sourceProvider: 'deezer',
    sourceTrackId: id,
    sourceArtistId: artistId,
    title: normalizeText(item?.title) || normalizeText(item?.title_short) || 'Без названия',
    artistName: normalizeText(item?.artist?.name) || 'Deezer',
    artistAvatar: coverUrl || '/assets/covers/default.png',
    artistFollowers: 0,
    artistSourceUrl: artistUrl || null,
    genre: 'Музыка',
    durationSeconds,
    durationText: secondsToDurationText(durationSeconds),
    cover: coverUrl || '/assets/covers/default.png',
    audioUrl: previewUrl,
    preview: previewUrl,
    sourceUrl: sourceUrl || artistUrl || null,
    albumTitle: normalizeText(item?.album?.title) || null,
    explicitLyrics: Boolean(item?.explicit_lyrics),
    payload: {
      provider: 'deezer',
      previewUrl,
      sourceUrl: sourceUrl || null,
      artistUrl: artistUrl || null
    },
    sourceDataset: 'deezer-search',
    originStorageUrl: previewUrl,
    storageObjectKey: null,
    cacheFilePath: null,
    audioMimeType: 'audio/mpeg',
    plays: Math.max(0, Number(item?.rank || 0))
  };
}

async function searchTracks(query, options = {}) {
  const term = normalizeText(query);
  if (!term) return [];

  const limit = Math.max(1, Number(options.limit || process.env.DEEZER_RESULT_LIMIT || 6));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.DEEZER_TIMEOUT_MS || 5000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL('https://api.deezer.com/search');
    endpoint.searchParams.set('q', term);
    endpoint.searchParams.set('limit', String(limit));

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.1'
      }
    });

    if (!response.ok) {
      throw new Error(`Deezer ответил со статусом ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error.message || 'Deezer вернул ошибку');
    }

    return (Array.isArray(payload?.data) ? payload.data : [])
      .map(normalizeTrack)
      .filter(Boolean)
      .slice(0, limit);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  searchTracks
};
