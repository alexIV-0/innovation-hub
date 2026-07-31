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

-- User wallet balance (display-only for now; top-up is a stub in the UI).
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;

-- ===== FF Works workspace: projects, files, chat =====
-- Legacy installs already have `projects` with user_id / is_active / drive_folder_id.
-- Fresh installs get the full CREATE; existing DBs pick up columns via ALTER.
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  group_name   TEXT NOT NULL DEFAULT 'personal',
  is_paused    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Keep is_paused in sync with legacy is_active when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'projects' AND column_name = 'is_active'
  ) THEN
    UPDATE projects SET is_paused = NOT COALESCE(is_active, TRUE)
     WHERE is_paused = FALSE AND is_active = FALSE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_owner_idx
  ON projects (user_id, group_name, created_at DESC);

CREATE TABLE IF NOT EXISTS project_files (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_path   TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  is_folder     BOOLEAN NOT NULL DEFAULT FALSE,
  s3_key        TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  content_type  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_files_folder_s3_chk
    CHECK (
      (is_folder = TRUE  AND s3_key IS NULL) OR
      (is_folder = FALSE AND s3_key IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS project_files_unique_name_idx
  ON project_files (project_id, folder_path, name);

CREATE INDEX IF NOT EXISTS project_files_project_folder_idx
  ON project_files (project_id, folder_path);

CREATE INDEX IF NOT EXISTS project_files_s3_key_idx
  ON project_files (s3_key)
  WHERE s3_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_files_created_at_idx
  ON project_files (project_id, created_at DESC)
  WHERE is_folder = FALSE;

CREATE TABLE IF NOT EXISTS project_messages (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_role   TEXT NOT NULL CHECK (sender_role IN ('user', 'team')),
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_by_user  BOOLEAN NOT NULL DEFAULT FALSE,
  read_by_team  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS project_messages_project_idx
  ON project_messages (project_id, created_at ASC);

CREATE INDEX IF NOT EXISTS project_messages_unread_user_idx
  ON project_messages (project_id)
  WHERE sender_role = 'team' AND read_by_user = FALSE;
