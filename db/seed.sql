INSERT INTO artists (id, name, tagline, bio, avatar_url, followers_count, created_at, updated_at)
VALUES
  (
    'a1',
    'Ethan Black',
    'Электронная музыка',
    'Пишу атмосферные синты, мягкие басы и мелодии для позднего вечера.',
    '/assets/covers/author-a1.png',
    18,
    '2026-01-10T18:00:00Z',
    '2026-01-10T18:00:00Z'
  ),
  (
    'a2',
    'Luna Sky',
    'Lo-fi / Chill',
    'Lo-fi для фокуса и отдыха. Минимализм и тёплый звук.',
    '/assets/covers/author-a2.png',
    12,
    '2026-01-12T18:00:00Z',
    '2026-01-12T18:00:00Z'
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  followers_count = EXCLUDED.followers_count,
  updated_at = NOW();

INSERT INTO users (id, email, display_name, role, password_hash, primary_provider, artist_id, created_at, updated_at)
VALUES
  (
    'u_admin',
    'admin@soundhub.local',
    'Админ',
    'admin',
    'bdbd2f243480ab30c21b33c3fb995d04:d2b16a30b4a86596b6b86c9464dc9c9f13b788972107ce64753a88243b324bbd307591c01e5ee825606d9ef34dba4b48012900a100d71ebd1cedc10804b9d2ed',
    'local',
    NULL,
    '2026-01-10T18:00:00Z',
    '2026-01-10T18:00:00Z'
  ),
  (
    'u_artist',
    'artist@soundhub.local',
    'Исполнитель',
    'artist',
    'a64246a05c88d2c55a34339c53eeb3aa:818463e0f645e0a794a4c70f3dbb481bdeeea1270cdb68c622dda8a8ac54a6fbab5448aa00032c29e4b70051bb434793478e94a4ee282fd3fcde24a1917e6ea1',
    'local',
    'a1',
    '2026-01-10T18:00:00Z',
    '2026-01-10T18:00:00Z'
  ),
  (
    'u_user',
    'user@soundhub.local',
    'Пользователь',
    'user',
    '10f385a4df2880692c1e839811ebc988:9f50262a3f1ca1d77ca6cdfd8b5469da3067d6f0734c7417613f378b702fe80faf683ab8fcf47384c9a9283cb04ff009039dae89b7cde1221844ea990403fbac',
    'local',
    NULL,
    '2026-01-10T18:00:00Z',
    '2026-01-10T18:00:00Z'
  )
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  primary_provider = EXCLUDED.primary_provider,
  artist_id = EXCLUDED.artist_id,
  updated_at = NOW();
