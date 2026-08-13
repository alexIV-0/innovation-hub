-- Конвейер: фундамент под админскую страницу обработки (/admin/pipeline).
--
-- 1. Развязка флагов проекта.
--
-- Было три перекрывающихся понятия «выключено»:
--   is_paused   — пользователь приостановил проект;
--   is_archived — архив, обработчики пропускают;
--   is_active   — legacy-поле, которое folder-state роут начал использовать
--                 как зеркало options/folderState.json на R2.
--
-- Беда в том, что is_active и is_paused были сварены друг с другом в
-- lib/repositories/projects.ts (updateProject) и в DO-блоке db/schema.sql:
-- выключение автоматизации ставило проекту «Приостановлен», а пауза проекта
-- гасила is_active в Postgres, не тронув сайдкар на R2. Локальная машина
-- при этом видела одно состояние, а десктоп в папке — другое.
--
-- Теперь тумблер слежения один: is_paused. Он же зеркало folderState.enabled
-- (enabled = NOT is_paused), и записью обоих хранилищ владеет одна функция
-- lib/project-automation.ts#setProjectPaused. is_active удаляется; поле
-- isActive в ответах машинам остаётся и считается как NOT is_paused, поэтому
-- контракт POST /api/v1 не меняется и десктоп пересобирать не нужно.
--
-- Проверено перед удалением: расхождений (is_paused не инверсия is_active)
-- в базе нет, поэтому конвертировать нечего.

ALTER TABLE projects DROP COLUMN IF EXISTS is_active;

-- 2. Админский гейт уровня пользователя.
--
-- Гасит слежение за всеми проектами пользователя, не меняя флаги самих
-- проектов: включил обратно — всё вернулось как было. Расшаренный проект
-- гейтится флагом ВЛАДЕЛЬЦА, потому что projects.user_id — это владелец,
-- а не тот, кому дали доступ.
--
-- Default FALSE осознанно: конвейер не должен начать следить за всеми
-- пользователями сразу после миграции.

ALTER TABLE users ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Курсор сканера.
--
-- Сканер не обходит папки и не держит watcher'ов: все пути записи уже
-- журналируют в storage_changes (lib/storage/write-path.ts#journal), поэтому
-- «что нового появилось в IN» — это выборка по seq > last_seq. Одна строка на
-- всю установку, id фиксирован.

CREATE TABLE IF NOT EXISTS automation_scan_state (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  last_seq   BIGINT NOT NULL DEFAULT 0,
  scanned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_scan_state_singleton_chk CHECK (id = 'singleton')
);

INSERT INTO automation_scan_state (id, last_seq)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;

-- 4. Очередь задач.
--
-- payload — объект для обработки в форме, которую понимает десктопный движок
-- (processingQueue + шаги по ключам + description). Внутри НЕТ ни presigned
-- URL, ни локальных путей: только идентичность файлов, байты машина берёт
-- экшеном presign. Иначе задача, простоявшая в очереди час, приезжает с
-- истёкшими ссылками.
--
-- claimed_by / lease_expires_at — под будущую атомарную выдачу
-- (SELECT ... FOR UPDATE SKIP LOCKED + продление lease через heartbeat).
-- На этом шаге задачи только создаются, машинам не выдаются.

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id    TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  source_key        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'claimed', 'running', 'done', 'failed')),
  claimed_by        TEXT REFERENCES remote_computers(id) ON DELETE SET NULL,
  claimed_at        TIMESTAMPTZ,
  lease_expires_at  TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Очередь: выборка следующей задачи в работу.
CREATE INDEX IF NOT EXISTS tasks_queue_idx
  ON tasks (status, created_at)
  WHERE status IN ('queued', 'claimed', 'running');

CREATE INDEX IF NOT EXISTS tasks_project_idx
  ON tasks (project_id, created_at DESC);

-- Дедуп: один и тот же файл не должен породить вторую живую задачу, если
-- по нему прилетело несколько put-событий (перезапись, reindex, повторный
-- notify). Завершённые и упавшие под ограничение не попадают — по файлу
-- можно прогнать обработку заново.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_source_idx
  ON tasks (project_id, source_key)
  WHERE status IN ('queued', 'claimed', 'running');
