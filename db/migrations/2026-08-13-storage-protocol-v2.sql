-- Protocol v2: move journal, case-insensitive live names, trash retention.

ALTER TABLE storage_changes DROP CONSTRAINT IF EXISTS storage_changes_op_check;
ALTER TABLE storage_changes ADD CONSTRAINT storage_changes_op_check
  CHECK (op IN ('put', 'delete', 'move'));

ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_files_trash_idx
  ON project_files (project_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Live names must be unique ignoring case. Soft-deleted rows are exempt.
DROP INDEX IF EXISTS project_files_unique_name_idx;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id, lower(folder_path), lower(name)
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM project_files
   WHERE deleted_at IS NULL
)
UPDATE project_files f
   SET name = f.name || ' (dup-' || substr(f.id, 1, 8) || ')'
  FROM ranked r
 WHERE f.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX project_files_unique_name_idx
  ON project_files (project_id, lower(folder_path), lower(name))
  WHERE deleted_at IS NULL;
