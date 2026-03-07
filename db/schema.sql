DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'artist', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE auth_provider AS ENUM ('local', 'google', 'vk', 'yandex');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE track_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT,
  bio TEXT,
  avatar_url TEXT NOT NULL DEFAULT '/assets/covers/default.png',
  followers_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS source_artist_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  password_hash TEXT,
  primary_provider auth_provider NOT NULL DEFAULT 'local',
  avatar_url TEXT,
  artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_oauth_links (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider auth_provider NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT 'Unknown',
  duration_text TEXT NOT NULL DEFAULT '0:00',
  cover_url TEXT NOT NULL DEFAULT '/assets/covers/default.png',
  audio_url TEXT NOT NULL DEFAULT '/audio/sample.wav',
  status track_status NOT NULL DEFAULT 'pending',
  plays_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS source_track_id TEXT,
  ADD COLUMN IF NOT EXISTS source_artist_id TEXT,
  ADD COLUMN IF NOT EXISTS source_album_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS album_title TEXT,
  ADD COLUMN IF NOT EXISTS preview_url TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS explicit_lyrics BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_payload JSONB,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imported_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_dataset TEXT,
  ADD COLUMN IF NOT EXISTS origin_storage_url TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_key TEXT,
  ADD COLUMN IF NOT EXISTS cache_file_path TEXT,
  ADD COLUMN IF NOT EXISTS audio_mime_type TEXT NOT NULL DEFAULT 'audio/mpeg';

CREATE TABLE IF NOT EXISTS track_status_events (
  id BIGSERIAL PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  from_status track_status,
  to_status track_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  owner_name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  total_duration_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT '/assets/covers/default.png',
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS source_playlist_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id),
  UNIQUE (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS user_track_likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS artist_followers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, artist_id)
);

CREATE TABLE IF NOT EXISTS track_play_events (
  id BIGSERIAL PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks (artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks (status);
CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_source_provider ON tracks (source_provider, source_track_id);
CREATE INDEX IF NOT EXISTS idx_tracks_imported_by_user_id ON tracks (imported_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_source_dataset ON tracks (source_dataset);
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_track_likes_track_id ON user_track_likes (track_id);
CREATE INDEX IF NOT EXISTS idx_track_play_events_track_id ON track_play_events (track_id);
CREATE INDEX IF NOT EXISTS idx_track_play_events_user_id ON track_play_events (user_id);
CREATE INDEX IF NOT EXISTS idx_artist_followers_artist_id ON artist_followers (artist_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_source_lookup
  ON artists (source_provider, source_artist_id)
  WHERE source_provider IS NOT NULL AND source_artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_source_lookup
  ON tracks (source_provider, source_track_id)
  WHERE source_provider IS NOT NULL AND source_track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_source_lookup
  ON playlists (source_provider, source_playlist_id)
  WHERE source_provider IS NOT NULL AND source_playlist_id IS NOT NULL;

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artists_touch_updated_at ON artists;
CREATE TRIGGER trg_artists_touch_updated_at
BEFORE UPDATE ON artists
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_users_touch_updated_at ON users;
CREATE TRIGGER trg_users_touch_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_tracks_touch_updated_at ON tracks;
CREATE TRIGGER trg_tracks_touch_updated_at
BEFORE UPDATE ON tracks
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_playlists_touch_updated_at ON playlists;
CREATE TRIGGER trg_playlists_touch_updated_at
BEFORE UPDATE ON playlists
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();
