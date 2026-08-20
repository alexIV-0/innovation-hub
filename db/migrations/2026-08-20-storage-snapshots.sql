-- Ежедневные срезы состояний (docs/STATISTICS_PLAN.md §3, §7.1).
--
-- Зачем таблица, если объём и число файлов видно в project_files: у состояний
-- нет истории по определению. Удалили файл — строка ушла, и вчерашний объём
-- восстановить нечем. «Как рос объём» считается только по снимкам, и история
-- начинается с дня, когда таблицу завели.
--
-- Гранулярность одна — проект × день. Срез по пользователю не хранится отдельно:
-- это SUM по его проектам, а второе хранилище того же факта пришлось бы
-- согласовывать. Число проектов за день — COUNT строк.
--
-- Внешних ключей нет намеренно: срез должен переживать удаление проекта и
-- пользователя, иначе история схлопнется ровно в тот момент, когда она нужна.
CREATE TABLE IF NOT EXISTS storage_snapshots (
  day        DATE NOT NULL,
  project_id TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  files      INTEGER NOT NULL DEFAULT 0,
  bytes      BIGINT  NOT NULL DEFAULT 0,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, project_id)
);

CREATE INDEX IF NOT EXISTS storage_snapshots_owner_day_idx
  ON storage_snapshots (owner_id, day);

CREATE INDEX IF NOT EXISTS storage_snapshots_day_idx
  ON storage_snapshots (day);
