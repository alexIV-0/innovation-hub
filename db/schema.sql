CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration: support OAuth providers (Google, ...) alongside local
-- email + password accounts. OAuth-only users have no password, so we drop the
-- NOT NULL constraint on password_hash and add provider columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- One Google `sub` (or any provider's account id) maps to at most one user;
-- partial unique index lets multiple rows have NULL provider_account_id.
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_account_idx
  ON users (auth_provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  thumbnail    TEXT NOT NULL,
  video_url    TEXT NOT NULL,
  duration     TEXT NOT NULL,
  category     TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS videos_published_sort_idx
  ON videos (is_published, sort_order, created_at);

CREATE TABLE IF NOT EXISTS ideas (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration: ideas grew media fields so the admin uses one unified
-- "content" form for both kinds. Defaults are empty strings to keep existing
-- rows valid and the public renderer (which still ignores these for ideas)
-- unaffected.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS thumbnail TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS duration  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS ideas_published_sort_idx
  ON ideas (is_published, sort_order, created_at);

-- Multi-tag support (replaces single category over time; category kept for transition)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ideas  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

UPDATE videos SET tags = ARRAY[category]
 WHERE tags = '{}' AND category IS NOT NULL AND category <> '';

UPDATE ideas SET tags = ARRAY[category]
 WHERE tags = '{}' AND category IS NOT NULL AND category <> '';

CREATE INDEX IF NOT EXISTS videos_tags_gin ON videos USING GIN (tags);
CREATE INDEX IF NOT EXISTS ideas_tags_gin  ON ideas  USING GIN (tags);

-- Remembered values for admin combobox fields (scoped per field)
CREATE TABLE IF NOT EXISTS tag_suggestions (
  field_scope  TEXT NOT NULL,
  value        TEXT NOT NULL,
  usage_count  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (field_scope, value)
);

CREATE INDEX IF NOT EXISTS tag_suggestions_scope_value_idx
  ON tag_suggestions (field_scope, lower(value));

-- Page-view tracking for the admin "Visitors" dashboard. Each row is a single
-- client-side navigation reported by VisitorTracker. user_id is a soft
-- reference (no FK) so deleting a user does not blow away historical visits;
-- user_email/user_full_name are denormalized for the same reason. fingerprint
-- is a stable short hash of ip+UA+Accept-Language used to group anonymous
-- sessions.
CREATE TABLE IF NOT EXISTS visitor_events (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL,
  query_string    TEXT NOT NULL DEFAULT '',
  method          TEXT NOT NULL DEFAULT 'GET',
  user_id         TEXT,
  user_email      TEXT,
  user_full_name  TEXT,
  fingerprint     TEXT NOT NULL,
  user_agent      TEXT NOT NULL DEFAULT '',
  ip              TEXT NOT NULL DEFAULT '',
  referer         TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS visitor_events_created_at_idx
  ON visitor_events (created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_fingerprint_idx
  ON visitor_events (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_user_idx
  ON visitor_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitor_events_path_idx
  ON visitor_events (path);

-- Client cabinet: each user gets a Google Drive folder (named by email).
-- Projects live as subfolders; media files are uploaded into the project folder.
ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  drive_folder_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_user_created_idx
  ON projects (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_media (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT,
  drive_file_id TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_media_project_created_idx
  ON project_media (project_id, created_at DESC);
