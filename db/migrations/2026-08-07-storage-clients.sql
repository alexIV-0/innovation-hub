-- Client grouping for projects (logical hierarchy; R2 key layout unchanged).

CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clients_user_idx
  ON clients (user_id, created_at DESC);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_client_idx
  ON projects (client_id)
  WHERE client_id IS NOT NULL;
