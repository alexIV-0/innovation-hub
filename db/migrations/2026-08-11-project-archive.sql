-- Архив проекта отдельным флагом.
--
-- Раньше «в архиве» кодировалось через group_name = 'archive', то есть
-- группировка и статус были одним полем: проект нельзя было держать
-- в своей группе и одновременно считать архивным. Теперь статус живёт
-- в is_archived, а group_name отвечает только за раскладку в интерфейсе.
--
-- Обработчики (машинные токены, /api/storage/v1/projects) должны
-- пропускать проекты с is_archived = TRUE.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Переносим то, что уже лежало в группе «archive».
UPDATE projects
   SET is_archived = TRUE,
       archived_at = COALESCE(archived_at, updated_at, NOW())
 WHERE group_name = 'archive'
   AND is_archived = FALSE;

-- Группа больше не несёт смысл статуса: возвращаем таким проектам
-- нейтральную группу, чтобы после разархивации они не потерялись.
UPDATE projects
   SET group_name = 'personal'
 WHERE group_name = 'archive';

CREATE INDEX IF NOT EXISTS projects_user_archived_idx
  ON projects (user_id, is_archived, created_at DESC);
