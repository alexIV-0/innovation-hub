-- Remote access fleet: computers with heartbeat/status for future job scheduler.

CREATE TABLE IF NOT EXISTS remote_computers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  token_hash          TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'busy', 'error')),
  current_project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  current_task        TEXT,
  last_heartbeat_at   TIMESTAMPTZ,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS remote_computers_active_idx
  ON remote_computers (created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS remote_computers_heartbeat_idx
  ON remote_computers (last_heartbeat_at DESC NULLS LAST)
  WHERE revoked_at IS NULL;
