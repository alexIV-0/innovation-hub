-- Выдача задач машинам: прогресс шагов, сборка протухших аренд, самозапись
-- машины по UUID. Запрошено в fs.manager.tauri/ideasAndTest/PIPELINE_BACKEND_REQUESTS.md
-- §3, §4; модель — DISTRIBUTED_QUEUE_PLAN.md (pull, судья — БД, аренда + heartbeat).

-- 1. Прогресс выполнения.
--
-- Таблица самоочищающаяся: появилась задача — шаги видны, завершилась — строки
-- удаляются вместе с payload. Держать историю шагов навсегда незачем: разбор
-- падения идёт по task.error и логам машины, а живой прогресс нужен ровно пока
-- задача в работе.
CREATE TABLE IF NOT EXISTS task_progress (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'done', 'error')),
  message    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, step_id)
);

-- 2. Индекс под сборщик протухших аренд.
--
-- Без него это скан таблицы на каждом тике runner.ts (15 с). Частичный: строки
-- завершённых задач сборщика не интересуют.
CREATE INDEX IF NOT EXISTS tasks_lease_idx
  ON tasks (lease_expires_at)
  WHERE status IN ('claimed', 'running');

-- 3. Самозапись машины по UUID.
--
-- Раньше компьютер надо было заводить в админке руками. Машина приходит с токеном
-- и своим UUID — сайт сам создаёт строку при первом обращении.
--
-- Почему UUID, а не hostname: у машины он генерируется один раз при первом
-- запуске и лежит в её настройках. Hostname для этого не годится — дефолтные имена
-- маков совпадают сплошь и рядом, и на совпадении ломается не очередь, а архив
-- статистики: две машины начнут писать в один объект, а в объектном хранилище нет
-- дописывания в конец, заливка перезаписывает объект целиком и строки затрутся
-- тихо. Hostname остаётся человекочитаемой подписью в name.
ALTER TABLE remote_computers ADD COLUMN IF NOT EXISTS machine_uuid TEXT;

-- Одна строка на UUID среди неотозванных. Частичный индекс, а не UNIQUE на
-- колонке: отозвав компьютер, ту же машину можно завести заново, и старая строка
-- этому мешать не должна.
CREATE UNIQUE INDEX IF NOT EXISTS remote_computers_machine_uuid_idx
  ON remote_computers (machine_uuid)
  WHERE machine_uuid IS NOT NULL AND revoked_at IS NULL;

-- 4. Кто держит задачу — связью, а не строкой.
--
-- current_task остаётся свободным TEXT для человекочитаемой метки операции
-- («export-preview»), а для продления аренды нужна именно ссылка на задачу.
ALTER TABLE remote_computers
  ADD COLUMN IF NOT EXISTS current_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
