-- Storage sync contract: cache fields on project_files, change journal, machine tokens.

ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS origin_mtime INTEGER,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seq BIGINT;

CREATE TABLE IF NOT EXISTS storage_changes (
  seq          BIGSERIAL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('put', 'delete')),
  size         BIGINT,
  etag         TEXT,
  content_hash TEXT,
  event_time   INTEGER NOT NULL,
  event_id     TEXT UNIQUE,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS storage_changes_project_seq_idx
  ON storage_changes (project_id, seq);

CREATE INDEX IF NOT EXISTS storage_changes_key_idx
  ON storage_changes (key);

CREATE INDEX IF NOT EXISTS storage_changes_seq_idx
  ON storage_changes (seq);

CREATE TABLE IF NOT EXISTS machine_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS machine_tokens_user_idx
  ON machine_tokens (user_id)
  WHERE revoked_at IS NULL;
