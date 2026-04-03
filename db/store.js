const crypto = require('crypto');
const { withClient, withTransaction } = require('./pool');

const TRACK_COLUMNS = [
  'id',
  'artist_id',
  'submitted_by_user_id',
  'title',
  'genre',
  'duration_text',
  'cover_url',
  'audio_url',
  'status',
  'plays_count',
  'likes_count',
  'published_at',
  'rejected_at',
  'created_at',
  'updated_at',
  'source_provider',
  'source_track_id',
  'source_artist_id',
  'source_album_id',
  'source_url',
  'album_title',
  'preview_url',
  'duration_seconds',
  'explicit_lyrics',
  'source_payload',
  'last_synced_at',
  'imported_by_user_id',
  'source_dataset',
  'origin_storage_url',
  'storage_object_key',
  'cache_file_path',
  'audio_mime_type'
];

const TRACK_FIELDS = TRACK_COLUMNS.map(column => `t.${column}`).join(',\n  ');
const TRACK_RETURNING = TRACK_COLUMNS.join(',\n          ');

const PLAYLIST_SELECT = `
  SELECT
    p.id,
    p.title,
    p.description,
    p.owner_name,
    p.owner_user_id,
    p.total_duration_text,
    p.cover_url,
    p.source_provider,
    p.source_playlist_id,
    p.source_url,
    p.created_at,
    p.updated_at,
    COALESCE(
      ARRAY_AGG(pt.track_id ORDER BY pt.position) FILTER (WHERE pt.track_id IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS track_ids
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
`;

const PLAYLIST_GROUP_BY = `
  GROUP BY
    p.id,
    p.title,
    p.description,
    p.owner_name,
    p.owner_user_id,
    p.total_duration_text,
    p.cover_url,
    p.source_provider,
    p.source_playlist_id,
    p.source_url,
    p.created_at,
    p.updated_at
`;

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function durationTextToSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;

  const parts = raw.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(parts[0] || 0);
}

function secondsToDurationText(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function secondsToPlaylistTotal(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  if (!total) return '0 мин';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} ч ${minutes} мин`;
  return `${minutes || 1} мин`;
}

function sanitizeCatalogCopy(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (lowered.includes('deezer') || lowered.includes('imported') || lowered.includes('импорт') || lowered.includes('api')) {
    return fallback;
  }

  return normalized;
}

function mapArtist(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tagline: sanitizeCatalogCopy(row.tagline),
    bio: sanitizeCatalogCopy(row.bio),
    avatar: row.avatar_url,
    sourceProvider: row.source_provider || null,
    sourceArtistId: row.source_artist_id || null,
    sourceUrl: row.source_url || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    stats: {
      followers: Number(row.followers_count || 0)
    }
  };
}

function mapTrack(row) {
  if (!row) return null;
  return {
    id: row.id,
    artistId: row.artist_id,
    submittedBy: row.submitted_by_user_id,
    title: row.title,
    genre: sanitizeCatalogCopy(row.genre, 'Музыка'),
    duration: row.duration_text,
    durationSeconds: Number(row.duration_seconds || 0),
    cover: row.cover_url,
    audio: row.audio_url || row.preview_url || null,
    preview: row.preview_url || row.audio_url || null,
    status: row.status,
    plays: Number(row.plays_count || 0),
    likes: Number(row.likes_count || 0),
    publishedAt: toIso(row.published_at),
    rejectedAt: toIso(row.rejected_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    sourceProvider: row.source_provider || null,
    sourceTrackId: row.source_track_id || null,
    sourceArtistId: row.source_artist_id || null,
    sourceAlbumId: row.source_album_id || null,
    sourceUrl: row.source_url || null,
    albumTitle: row.album_title || null,
    explicitLyrics: Boolean(row.explicit_lyrics),
    sourcePayload: row.source_payload || null,
    lastSyncedAt: toIso(row.last_synced_at),
    importedByUserId: row.imported_by_user_id || null,
    sourceDataset: row.source_dataset || null,
    originStorageUrl: row.origin_storage_url || null,
    storageObjectKey: row.storage_object_key || null,
    cacheFilePath: row.cache_file_path || null,
    audioMimeType: row.audio_mime_type || 'audio/mpeg'
  };
}

function mapPlaylist(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: sanitizeCatalogCopy(row.description),
    owner: row.owner_name,
    ownerUserId: row.owner_user_id,
    total: row.total_duration_text,
    cover: row.cover_url,
    sourceProvider: row.source_provider || null,
    sourcePlaylistId: row.source_playlist_id || null,
    sourceUrl: row.source_url || null,
    trackIds: Array.isArray(row.track_ids) ? row.track_ids : [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapUser(row, oauthLinks) {
  if (!row) return null;
  const links = oauthLinks || {};
  const primaryLink = links[row.primary_provider] || null;

  return {
    id: row.id,
    provider: row.primary_provider,
    providerId: primaryLink?.providerId || null,
    email: row.email,
    displayName: row.display_name,
    avatar: row.avatar_url,
    role: row.role,
    artistId: row.artist_id,
    passwordHash: row.password_hash,
    oauthLinks: links,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function buildImportedArtistId(provider, sourceArtistId) {
  return `a_${provider}_${sourceArtistId}`;
}

function buildImportedTrackId(provider, sourceTrackId) {
  return `t_${provider}_${sourceTrackId}`;
}

function buildImportedPlaylistId(provider, sourcePlaylistId) {
  return `p_${provider}_${sourcePlaylistId}`;
}

async function loadOauthLinks(client, userId) {
  const { rows } = await client.query(
    `
      SELECT provider, provider_user_id, email, avatar_url, linked_at, last_login_at
      FROM user_oauth_links
      WHERE user_id = $1
      ORDER BY provider
    `,
    [userId]
  );

  const links = {};
  for (const row of rows) {
    links[row.provider] = {
      providerId: row.provider_user_id,
      email: row.email,
      avatar: row.avatar_url,
      linkedAt: toIso(row.linked_at),
      lastLoginAt: toIso(row.last_login_at)
    };
  }

  return links;
}

async function findUserById(id) {
  if (!id) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!rows[0]) return null;
    const oauthLinks = await loadOauthLinks(client, rows[0].id);
    return mapUser(rows[0], oauthLinks);
  });
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
        FROM users
        WHERE primary_provider = 'local' AND email = $1
        LIMIT 1
      `,
      [normalized]
    );
    if (!rows[0]) return null;
    const oauthLinks = await loadOauthLinks(client, rows[0].id);
    return mapUser(rows[0], oauthLinks);
  });
}

async function findUserByEmailAnyProvider(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [normalized]
    );
    if (!rows[0]) return null;
    const oauthLinks = await loadOauthLinks(client, rows[0].id);
    return mapUser(rows[0], oauthLinks);
  });
}

async function createLocalUser({ id, email, displayName, passwordHash }) {
  const normalizedEmail = normalizeEmail(email);

  return withTransaction(async client => {
    const { rows } = await client.query(
      `
        INSERT INTO users (
          id,
          email,
          display_name,
          role,
          password_hash,
          primary_provider,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'user', $4, 'local', NOW(), NOW())
        RETURNING id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
      `,
      [id, normalizedEmail, displayName, passwordHash]
    );
    return mapUser(rows[0], {});
  });
}

async function upsertOauthUser({ provider, providerId, email, displayName, avatar }) {
  const normalizedEmail = normalizeEmail(email);
  const profileDisplayName = displayName ? String(displayName).trim() : null;
  const safeDisplayName = profileDisplayName || normalizedEmail || 'User';
  const safeProviderId = String(providerId);

  return withTransaction(async client => {
    const directMatch = await client.query(
      `
        SELECT u.id, u.email, u.display_name, u.role, u.password_hash, u.primary_provider, u.avatar_url, u.artist_id, u.created_at, u.updated_at
        FROM users u
        INNER JOIN user_oauth_links l ON l.user_id = u.id
        WHERE l.provider = $1 AND l.provider_user_id = $2
        LIMIT 1
      `,
      [provider, safeProviderId]
    );

    let userRow = directMatch.rows[0] || null;

    if (!userRow && normalizedEmail) {
      const byEmail = await client.query(
        `
          SELECT id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [normalizedEmail]
      );
      userRow = byEmail.rows[0] || null;
    }

    if (!userRow) {
      const newId = `u_${crypto.randomBytes(8).toString('hex')}`;
      const inserted = await client.query(
        `
          INSERT INTO users (
            id,
            email,
            display_name,
            role,
            password_hash,
            primary_provider,
            avatar_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'user', NULL, $4, $5, NOW(), NOW())
          RETURNING id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
        `,
        [newId, normalizedEmail || null, safeDisplayName, provider, avatar || null]
      );
      userRow = inserted.rows[0];
    } else {
      const updated = await client.query(
        `
          UPDATE users
          SET
            email = COALESCE($2, email),
            display_name = COALESCE($3, display_name),
            avatar_url = COALESCE($4, avatar_url),
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, email, display_name, role, password_hash, primary_provider, avatar_url, artist_id, created_at, updated_at
        `,
        [userRow.id, normalizedEmail || null, profileDisplayName || null, avatar || null]
      );
      userRow = updated.rows[0];
    }

    await client.query(
      `
        INSERT INTO user_oauth_links (
          user_id,
          provider,
          provider_user_id,
          email,
          avatar_url,
          linked_at,
          last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (user_id, provider) DO UPDATE
        SET
          provider_user_id = EXCLUDED.provider_user_id,
          email = EXCLUDED.email,
          avatar_url = EXCLUDED.avatar_url,
          last_login_at = NOW()
      `,
      [userRow.id, provider, safeProviderId, normalizedEmail || null, avatar || null]
    );

    const oauthLinks = await loadOauthLinks(client, userRow.id);
    return mapUser(userRow, oauthLinks);
  });
}

async function readAuthors() {
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT id, name, tagline, bio, avatar_url, followers_count, source_provider, source_artist_id, source_url, created_at, updated_at
        FROM artists
        ORDER BY name ASC
      `
    );
    return rows.map(mapArtist);
  });
}

async function findAuthorById(id) {
  if (!id) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT id, name, tagline, bio, avatar_url, followers_count, source_provider, source_artist_id, source_url, created_at, updated_at
        FROM artists
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    return mapArtist(rows[0]);
  });
}

async function readTracksRaw() {
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT ${TRACK_FIELDS}
        FROM tracks t
        ORDER BY COALESCE(t.published_at, t.created_at) DESC, t.id DESC
      `
    );
    return rows.map(mapTrack);
  });
}

async function searchTracks(term, limit = 24) {
  const query = String(term || '').trim();
  if (!query) return [];

  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT ${TRACK_FIELDS}
        FROM tracks t
        INNER JOIN artists a ON a.id = t.artist_id
        WHERE
          t.status = 'published'
          AND (
            t.title ILIKE $1 OR
            COALESCE(t.album_title, '') ILIKE $1 OR
            a.name ILIKE $1
          )
        ORDER BY t.plays_count DESC, t.created_at DESC
        LIMIT $2
      `,
      [`%${query}%`, limit]
    );
    return rows.map(mapTrack);
  });
}

async function findTrackByIdWithClient(client, id) {
  if (!id) return null;
  const { rows } = await client.query(
    `
      SELECT ${TRACK_FIELDS}
      FROM tracks t
      WHERE t.id = $1
      LIMIT 1
    `,
    [id]
  );
  return mapTrack(rows[0]);
}

async function findTrackById(id) {
  if (!id) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT ${TRACK_FIELDS}
        FROM tracks t
        WHERE t.id = $1
        LIMIT 1
      `,
      [id]
    );
    return mapTrack(rows[0]);
  });
}

async function findTrackBySource(provider, sourceTrackId) {
  if (!provider || !sourceTrackId) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        SELECT ${TRACK_FIELDS}
        FROM tracks t
        WHERE t.source_provider = $1 AND t.source_track_id = $2
        LIMIT 1
      `,
      [provider, String(sourceTrackId)]
    );
    return mapTrack(rows[0]);
  });
}

async function createTrack(track) {
  return withTransaction(async client => {
    const durationSeconds = Number(track.durationSeconds || durationTextToSeconds(track.duration));
    const { rows } = await client.query(
      `
        INSERT INTO tracks (
          id,
          artist_id,
          submitted_by_user_id,
          title,
          genre,
          duration_text,
          cover_url,
          audio_url,
          status,
          plays_count,
          likes_count,
          duration_seconds,
          published_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NOW(), NOW())
        RETURNING ${TRACK_RETURNING}
      `,
      [
        track.id,
        track.artistId,
        track.submittedBy || null,
        track.title,
        track.genre || 'Unknown',
        track.duration || '0:00',
        track.cover || '/assets/covers/default.png',
        track.audio || '/audio/sample.wav',
        track.status || 'pending',
        Number(track.plays || 0),
        Number(track.likes || 0),
        Number.isFinite(durationSeconds) ? durationSeconds : 0
      ]
    );

    await client.query(
      `
        INSERT INTO track_status_events (track_id, actor_user_id, from_status, to_status, created_at)
        VALUES ($1, $2, NULL, $3, NOW())
      `,
      [track.id, track.submittedBy || null, track.status || 'pending']
    );

    return mapTrack(rows[0]);
  });
}

async function upsertImportedArtistWithClient(client, artist) {
  const id = buildImportedArtistId(artist.sourceProvider, artist.sourceArtistId);
  const tagline = sanitizeCatalogCopy(artist.tagline, 'На волне сейчас');
  const bio = sanitizeCatalogCopy(artist.bio, null);

  const { rows } = await client.query(
    `
      INSERT INTO artists (
        id,
        name,
        tagline,
        bio,
        avatar_url,
        followers_count,
        source_provider,
        source_artist_id,
        source_url,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET
        name = EXCLUDED.name,
        tagline = EXCLUDED.tagline,
        bio = EXCLUDED.bio,
        avatar_url = EXCLUDED.avatar_url,
        followers_count = EXCLUDED.followers_count,
        source_provider = EXCLUDED.source_provider,
        source_artist_id = EXCLUDED.source_artist_id,
        source_url = EXCLUDED.source_url,
        updated_at = NOW()
      RETURNING id, name, tagline, bio, avatar_url, followers_count, source_provider, source_artist_id, source_url, created_at, updated_at
    `,
    [
      id,
      artist.name,
      tagline,
      bio,
      artist.avatar || '/assets/covers/default.png',
      Number(artist.followers || 0),
      artist.sourceProvider,
      String(artist.sourceArtistId),
      artist.sourceUrl || null
    ]
  );

  return mapArtist(rows[0]);
}

async function upsertImportedTrack(track) {
  if (!track?.sourceProvider || !track?.sourceTrackId) {
    throw new Error('Imported track requires sourceProvider and sourceTrackId');
  }

  return withTransaction(async client => {
    const artist = await upsertImportedArtistWithClient(client, {
      name: track.artistName,
      avatar: track.artistAvatar,
      followers: track.artistFollowers || 0,
      sourceProvider: track.sourceProvider,
      sourceArtistId: track.sourceArtistId,
      sourceUrl: track.artistSourceUrl || null
    });

    const trackId = buildImportedTrackId(track.sourceProvider, track.sourceTrackId);
    const durationSeconds = Number(track.durationSeconds || 0);
    const publishedAt = new Date().toISOString();
    const initialPlays = Math.max(0, Number(track.plays || 0));

    const { rows } = await client.query(
      `
        INSERT INTO tracks (
          id,
          artist_id,
          submitted_by_user_id,
          title,
          genre,
          duration_text,
          cover_url,
          audio_url,
          status,
          plays_count,
          likes_count,
          published_at,
          source_provider,
          source_track_id,
          source_artist_id,
          source_album_id,
          source_url,
          album_title,
          preview_url,
          duration_seconds,
          explicit_lyrics,
          source_payload,
          last_synced_at,
          imported_by_user_id,
          source_dataset,
          origin_storage_url,
          storage_object_key,
          cache_file_path,
          audio_mime_type,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, 0, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), $21, $22, $23, $24, $25, $26, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          artist_id = EXCLUDED.artist_id,
          submitted_by_user_id = COALESCE(tracks.submitted_by_user_id, EXCLUDED.submitted_by_user_id),
          title = EXCLUDED.title,
          genre = EXCLUDED.genre,
          duration_text = EXCLUDED.duration_text,
          cover_url = EXCLUDED.cover_url,
          audio_url = COALESCE(EXCLUDED.audio_url, tracks.audio_url),
          plays_count = GREATEST(tracks.plays_count, EXCLUDED.plays_count),
          status = 'published',
          published_at = COALESCE(tracks.published_at, EXCLUDED.published_at, NOW()),
          source_provider = EXCLUDED.source_provider,
          source_track_id = EXCLUDED.source_track_id,
          source_artist_id = EXCLUDED.source_artist_id,
          source_album_id = EXCLUDED.source_album_id,
          source_url = EXCLUDED.source_url,
          album_title = EXCLUDED.album_title,
          preview_url = COALESCE(EXCLUDED.preview_url, tracks.preview_url),
          duration_seconds = EXCLUDED.duration_seconds,
          explicit_lyrics = EXCLUDED.explicit_lyrics,
          source_payload = EXCLUDED.source_payload,
          last_synced_at = NOW(),
          imported_by_user_id = COALESCE(tracks.imported_by_user_id, EXCLUDED.imported_by_user_id),
          source_dataset = EXCLUDED.source_dataset,
          origin_storage_url = COALESCE(EXCLUDED.origin_storage_url, tracks.origin_storage_url),
          storage_object_key = COALESCE(EXCLUDED.storage_object_key, tracks.storage_object_key),
          cache_file_path = COALESCE(EXCLUDED.cache_file_path, tracks.cache_file_path),
          audio_mime_type = COALESCE(EXCLUDED.audio_mime_type, tracks.audio_mime_type),
          updated_at = NOW()
        RETURNING ${TRACK_RETURNING}
      `,
      [
        trackId,
        artist.id,
        track.importedByUserId || null,
        track.title,
        sanitizeCatalogCopy(track.genre, 'Музыка'),
        track.durationText || secondsToDurationText(durationSeconds),
        track.cover || '/assets/covers/default.png',
        track.audioUrl || track.preview || null,
        initialPlays,
        publishedAt,
        track.sourceProvider,
        String(track.sourceTrackId),
        track.sourceArtistId ? String(track.sourceArtistId) : null,
        track.sourceAlbumId ? String(track.sourceAlbumId) : null,
        track.sourceUrl || null,
        track.albumTitle || null,
        track.preview || null,
        durationSeconds,
        Boolean(track.explicitLyrics),
        track.payload || null,
        track.importedByUserId || null,
        track.sourceDataset || null,
        track.originStorageUrl || null,
        track.storageObjectKey || null,
        track.cacheFilePath || null,
        track.audioMimeType || 'audio/mpeg'
      ]
    );

    return mapTrack(rows[0]);
  });
}

async function upsertImportedTracks(tracks, importedByUserId = null) {
  const items = Array.isArray(tracks) ? tracks : [];
  const imported = [];

  for (const item of items) {
    imported.push(
      await upsertImportedTrack({
        ...item,
        importedByUserId: item.importedByUserId || importedByUserId
      })
    );
  }

  return imported;
}

async function updateTrackStatus(id, nextStatus, actorUserId) {
  const publishedValue = nextStatus === 'published' ? 'NOW()' : 'NULL';
  const rejectedValue = nextStatus === 'rejected' ? 'NOW()' : 'NULL';

  return withTransaction(async client => {
    const current = await client.query(
      `
        SELECT status
        FROM tracks
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (!current.rows[0]) return null;

    const updated = await client.query(
      `
        UPDATE tracks
        SET
          status = $2,
          published_at = ${publishedValue},
          rejected_at = ${rejectedValue},
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${TRACK_RETURNING}
      `,
      [id, nextStatus]
    );

    await client.query(
      `
        INSERT INTO track_status_events (track_id, actor_user_id, from_status, to_status, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `,
      [id, actorUserId || null, current.rows[0].status, nextStatus]
    );

    return mapTrack(updated.rows[0]);
  });
}

async function deleteTrack(id) {
  if (!id) return null;
  return withTransaction(async client => {
    const current = await client.query(
      `
        SELECT ${TRACK_FIELDS}
        FROM tracks t
        WHERE t.id = $1
        LIMIT 1
      `,
      [id]
    );
    if (!current.rows[0]) return null;

    await client.query('DELETE FROM tracks WHERE id = $1', [id]);
    return mapTrack(current.rows[0]);
  });
}

async function recomputePlaylistTotalWithClient(client, playlistId) {
  const { rows } = await client.query(
    `
      SELECT COALESCE(SUM(COALESCE(t.duration_seconds, 0)), 0)::INTEGER AS total_seconds
      FROM playlist_tracks pt
      INNER JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = $1
    `,
    [playlistId]
  );

  const totalSeconds = Number(rows[0]?.total_seconds || 0);
  const totalDurationText = secondsToPlaylistTotal(totalSeconds);

  await client.query(
    `
      UPDATE playlists
      SET total_duration_text = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [playlistId, totalDurationText]
  );
}

async function replacePlaylistTracksWithClient(client, playlistId, trackIds) {
  await client.query('DELETE FROM playlist_tracks WHERE playlist_id = $1', [playlistId]);

  const uniqueTrackIds = [...new Set((trackIds || []).filter(Boolean))];
  for (let index = 0; index < uniqueTrackIds.length; index += 1) {
    await client.query(
      `
        INSERT INTO playlist_tracks (playlist_id, track_id, position, created_at)
        VALUES ($1, $2, $3, NOW())
      `,
      [playlistId, uniqueTrackIds[index], index + 1]
    );
  }

  await recomputePlaylistTotalWithClient(client, playlistId);
}

async function readPlaylistsRaw() {
  return withClient(async client => {
    const { rows } = await client.query(
      `
        ${PLAYLIST_SELECT}
        ${PLAYLIST_GROUP_BY}
        ORDER BY p.created_at DESC, p.id DESC
      `
    );
    return rows.map(mapPlaylist);
  });
}

async function findPlaylistByIdWithClient(client, id) {
  if (!id) return null;
  const { rows } = await client.query(
    `
      ${PLAYLIST_SELECT}
      WHERE p.id = $1
      ${PLAYLIST_GROUP_BY}
    `,
    [id]
  );
  return mapPlaylist(rows[0]);
}

async function findPlaylistById(id) {
  if (!id) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        ${PLAYLIST_SELECT}
        WHERE p.id = $1
        ${PLAYLIST_GROUP_BY}
      `,
      [id]
    );
    return mapPlaylist(rows[0]);
  });
}

async function createPlaylist(playlist) {
  return withTransaction(async client => {
    const isImported = playlist.sourceProvider && playlist.sourcePlaylistId;
    const id = isImported
      ? buildImportedPlaylistId(playlist.sourceProvider, playlist.sourcePlaylistId)
      : playlist.id || `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    const { rows } = await client.query(
      `
        INSERT INTO playlists (
          id,
          title,
          description,
          owner_name,
          owner_user_id,
          total_duration_text,
          cover_url,
          source_provider,
          source_playlist_id,
          source_url,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          owner_name = EXCLUDED.owner_name,
          owner_user_id = COALESCE(playlists.owner_user_id, EXCLUDED.owner_user_id),
          total_duration_text = EXCLUDED.total_duration_text,
          cover_url = EXCLUDED.cover_url,
          source_provider = EXCLUDED.source_provider,
          source_playlist_id = EXCLUDED.source_playlist_id,
          source_url = EXCLUDED.source_url,
          updated_at = NOW()
        RETURNING id, title, description, owner_name, owner_user_id, total_duration_text, cover_url, source_provider, source_playlist_id, source_url, created_at, updated_at
      `,
      [
        id,
        playlist.title,
        playlist.description || null,
        playlist.ownerName || 'SoundHub',
        playlist.ownerUserId || null,
        playlist.totalDurationText || '0 мин',
        playlist.cover || '/assets/covers/default.png',
        playlist.sourceProvider || null,
        playlist.sourcePlaylistId ? String(playlist.sourcePlaylistId) : null,
        playlist.sourceUrl || null
      ]
    );

    if (Array.isArray(playlist.trackIds)) {
      await replacePlaylistTracksWithClient(client, id, playlist.trackIds);
    }

    const loaded = await client.query(
      `
        ${PLAYLIST_SELECT}
        WHERE p.id = $1
        ${PLAYLIST_GROUP_BY}
      `,
      [id]
    );

    return mapPlaylist(loaded.rows[0]);
  });
}

async function addTrackToPlaylist(playlistId, trackId) {
  return withTransaction(async client => {
    const playlist = await findPlaylistByIdWithClient(client, playlistId);
    if (!playlist) return null;

    const track = await findTrackByIdWithClient(client, trackId);
    if (!track) return null;

    const existing = await client.query(
      `
        SELECT 1
        FROM playlist_tracks
        WHERE playlist_id = $1 AND track_id = $2
        LIMIT 1
      `,
      [playlistId, trackId]
    );

    if (!existing.rows[0]) {
      const positionResult = await client.query(
        `
          SELECT COALESCE(MAX(position), 0) + 1 AS next_position
          FROM playlist_tracks
          WHERE playlist_id = $1
        `,
        [playlistId]
      );

      await client.query(
        `
          INSERT INTO playlist_tracks (playlist_id, track_id, position, created_at)
          VALUES ($1, $2, $3, NOW())
        `,
        [playlistId, trackId, Number(positionResult.rows[0]?.next_position || 1)]
      );

      if (!playlist.cover || playlist.cover === '/assets/covers/default.png') {
        await client.query(
          `
            UPDATE playlists
            SET cover_url = $2, updated_at = NOW()
            WHERE id = $1
          `,
          [playlistId, track.cover || '/assets/covers/default.png']
        );
      }
    }

    await recomputePlaylistTotalWithClient(client, playlistId);
    const updated = await client.query(
      `
        ${PLAYLIST_SELECT}
        WHERE p.id = $1
        ${PLAYLIST_GROUP_BY}
      `,
      [playlistId]
    );
    return mapPlaylist(updated.rows[0]);
  });
}

async function removeTrackFromPlaylist(playlistId, trackId) {
  return withTransaction(async client => {
    await client.query(
      `
        DELETE FROM playlist_tracks
        WHERE playlist_id = $1 AND track_id = $2
      `,
      [playlistId, trackId]
    );

    await recomputePlaylistTotalWithClient(client, playlistId);
    const updated = await client.query(
      `
        ${PLAYLIST_SELECT}
        WHERE p.id = $1
        ${PLAYLIST_GROUP_BY}
      `,
      [playlistId]
    );
    return mapPlaylist(updated.rows[0]);
  });
}

async function deletePlaylist(id) {
  if (!id) return false;
  return withTransaction(async client => {
    const deleted = await client.query(
      `
        DELETE FROM playlists
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );
    return deleted.rowCount > 0;
  });
}

async function getUserLikesWithClient(client, userId) {
  const { rows } = await client.query(
    `
      SELECT track_id
      FROM user_track_likes
      WHERE user_id = $1
      ORDER BY created_at ASC, track_id ASC
    `,
    [userId]
  );
  return rows.map(row => row.track_id);
}

async function getUserLikes(userId) {
  if (!userId) return [];
  return withClient(client => getUserLikesWithClient(client, userId));
}

async function syncTrackLikeCounts(client, trackIds) {
  const ids = [...new Set((trackIds || []).filter(Boolean))];
  if (!ids.length) return;

  await client.query(
    `
      UPDATE tracks AS t
      SET likes_count = src.cnt, updated_at = NOW()
      FROM (
        SELECT x.track_id, COUNT(utl.user_id)::INTEGER AS cnt
        FROM UNNEST($1::TEXT[]) AS x(track_id)
        LEFT JOIN user_track_likes utl ON utl.track_id = x.track_id
        GROUP BY x.track_id
      ) AS src
      WHERE t.id = src.track_id
    `,
    [ids]
  );
}

async function mergeGuestLikes(userId, guestTrackIds) {
  const ids = [...new Set((guestTrackIds || []).filter(Boolean))];
  if (!userId || !ids.length) return getUserLikes(userId);

  return withTransaction(async client => {
    await client.query(
      `
        INSERT INTO user_track_likes (user_id, track_id, created_at)
        SELECT $1, x.track_id, NOW()
        FROM UNNEST($2::TEXT[]) AS x(track_id)
        INNER JOIN tracks t ON t.id = x.track_id
        ON CONFLICT DO NOTHING
      `,
      [userId, ids]
    );
    await syncTrackLikeCounts(client, ids);
    return getUserLikesWithClient(client, userId);
  });
}

async function toggleTrackLike(userId, trackId) {
  return withTransaction(async client => {
    const removed = await client.query(
      `
        DELETE FROM user_track_likes
        WHERE user_id = $1 AND track_id = $2
        RETURNING track_id
      `,
      [userId, trackId]
    );

    let liked;
    if (removed.rowCount) {
      liked = false;
    } else {
      await client.query(
        `
          INSERT INTO user_track_likes (user_id, track_id, created_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT DO NOTHING
        `,
        [userId, trackId]
      );
      liked = true;
    }

    await syncTrackLikeCounts(client, [trackId]);
    const likes = await getUserLikesWithClient(client, userId);
    return { liked, likes };
  });
}

async function incrementTrackPlay(trackId, { userId, sessionId } = {}) {
  return withTransaction(async client => {
    const updated = await client.query(
      `
        UPDATE tracks
        SET plays_count = plays_count + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING plays_count
      `,
      [trackId]
    );

    if (!updated.rows[0]) return null;

    await client.query(
      `
        INSERT INTO track_play_events (track_id, user_id, session_id, played_at)
        VALUES ($1, $2, $3, NOW())
      `,
      [trackId, userId || null, sessionId || null]
    );

    return Number(updated.rows[0].plays_count || 0);
  });
}

async function setTrackCachePath(trackId, cacheFilePath) {
  if (!trackId) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        UPDATE tracks
        SET cache_file_path = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING ${TRACK_RETURNING}
      `,
      [trackId, cacheFilePath || null]
    );
    return mapTrack(rows[0]);
  });
}

async function updateTrackAudioSource(trackId, { audioUrl, previewUrl, originStorageUrl, audioMimeType } = {}) {
  if (!trackId) return null;
  return withClient(async client => {
    const { rows } = await client.query(
      `
        UPDATE tracks
        SET
          audio_url = COALESCE($2, audio_url),
          preview_url = COALESCE($3, preview_url),
          origin_storage_url = COALESCE($4, origin_storage_url),
          audio_mime_type = COALESCE($5, audio_mime_type),
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${TRACK_RETURNING}
      `,
      [trackId, audioUrl || null, previewUrl || null, originStorageUrl || null, audioMimeType || null]
    );
    return mapTrack(rows[0]);
  });
}

async function deleteTracksBySourceProvider(provider) {
  if (!provider) return 0;
  return withTransaction(async client => {
    const deleted = await client.query(
      `
        DELETE FROM tracks
        WHERE source_provider = $1
      `,
      [provider]
    );
    return Number(deleted.rowCount || 0);
  });
}

async function deletePlaylistsBySourceProvider(provider) {
  if (!provider) return 0;
  return withTransaction(async client => {
    const deleted = await client.query(
      `
        DELETE FROM playlists
        WHERE source_provider = $1
      `,
      [provider]
    );
    return Number(deleted.rowCount || 0);
  });
}

module.exports = {
  addTrackToPlaylist,
  buildImportedArtistId,
  buildImportedPlaylistId,
  buildImportedTrackId,
  createLocalUser,
  createPlaylist,
  createTrack,
  deletePlaylistsBySourceProvider,
  deletePlaylist,
  deleteTracksBySourceProvider,
  deleteTrack,
  findAuthorById,
  findPlaylistById,
  findTrackById,
  findTrackBySource,
  findUserByEmail,
  findUserByEmailAnyProvider,
  findUserById,
  getUserLikes,
  incrementTrackPlay,
  mergeGuestLikes,
  normalizeEmail,
  readAuthors,
  readPlaylistsRaw,
  readTracksRaw,
  removeTrackFromPlaylist,
  searchTracks,
  updateTrackAudioSource,
  setTrackCachePath,
  toggleTrackLike,
  updateTrackStatus,
  upsertImportedTrack,
  upsertImportedTracks,
  upsertOauthUser
};
