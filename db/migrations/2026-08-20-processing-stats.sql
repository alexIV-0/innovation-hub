-- Приёмник архива обработок (docs/PIPELINE.md §14, STATISTICS_PLAN.md §5A).
--
-- Зеркало замороженной схемы v1, которую пишут машины в
-- options/_stats/$YYYY.$MM[.машина].jsonl. Агрегаты не храним — считаем
-- запросом. Платно/бесплатно = status = 'done' AND total_cost > 0.
--
-- Ключ дедупа — item_id: строки в JSONL иммутабельны, обновлять нечего, поэтому
-- вставка идёт с ON CONFLICT DO NOTHING и файл можно перечитывать сколько угодно.
CREATE TABLE IF NOT EXISTS processing_stats (
  item_id        TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  schema_version INTEGER NOT NULL,
  status         TEXT NOT NULL,
  project_name   TEXT NOT NULL DEFAULT '',
  main_folder    TEXT NOT NULL DEFAULT '',
  cur_item       TEXT NOT NULL DEFAULT '',
  in_type        TEXT,
  out_type       TEXT,
  registered_at  TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  out_sec        INTEGER,
  render_sec     INTEGER,
  out_paths      JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost     NUMERIC(12, 6),
  machine        TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Запросы статистики всегда идут по времени и по проекту, иногда по машине.
CREATE INDEX IF NOT EXISTS processing_stats_ended_idx
  ON processing_stats (ended_at);
CREATE INDEX IF NOT EXISTS processing_stats_project_ended_idx
  ON processing_stats (project_id, ended_at);
CREATE INDEX IF NOT EXISTS processing_stats_machine_idx
  ON processing_stats (machine);

-- Курсор на каждый файл архива. Файл только дописывается, поэтому число уже
-- импортированных строк — валидный курсор, а etag говорит, есть ли смысл вообще
-- скачивать объект. Файлы разных машин не мешают друг другу: у каждого свой ключ.
--
-- etag = NULL значит «перечитать в следующий раз»: так помечается файл, у
-- которого последняя строка оказалась недописанной.
CREATE TABLE IF NOT EXISTS stats_import_state (
  s3_key         TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lines_imported INTEGER NOT NULL DEFAULT 0,
  etag           TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
