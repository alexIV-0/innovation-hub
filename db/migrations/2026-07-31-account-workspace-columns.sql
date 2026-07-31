-- Columns / tables required by the post-merge account + Drive workspace code.
-- Production deploys run `db:migrate` (not full db:init), so these must live
-- here or signin/account queries fail with empty HTTP 500s.
-- Idempotent: safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

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
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS yougile_chat_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS chat_last_read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_owner_idx
  ON projects (user_id, group_name, created_at DESC);

CREATE INDEX IF NOT EXISTS projects_user_created_idx
  ON projects (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS projects_drive_folder_id_idx
  ON projects (drive_folder_id)
  WHERE drive_folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_files (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_path   TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  is_folder     BOOLEAN NOT NULL DEFAULT FALSE,
  s3_key        TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  content_type  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_files_unique_name_idx
  ON project_files (project_id, folder_path, name);

CREATE INDEX IF NOT EXISTS project_files_project_folder_idx
  ON project_files (project_id, folder_path);

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

CREATE TABLE IF NOT EXISTS project_chat_messages (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('client', 'team', 'system')),
  sender_user_id      TEXT,
  sender_name         TEXT NOT NULL,
  body                TEXT NOT NULL,
  yougile_message_id  TEXT,
  delivered           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_chat_messages_project_created_idx
  ON project_chat_messages (project_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS project_chat_messages_yougile_id_idx
  ON project_chat_messages (yougile_message_id) WHERE yougile_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx
  ON push_subscriptions (endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);
