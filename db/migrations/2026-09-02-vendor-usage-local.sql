-- Локальные прогоны: расход есть, задачи нет
-- (VENDOR_KEYS_CLIENT_REQUESTS, пункт 4).
--
-- Настройка и отладка флоу идёт на машине, нашим ключом, и в биллинг такие
-- прогоны не идут — продавать нечего. Но у вендора деньги списались, а строк
-- потребления нет, и суточная сверка (С6) увидит расход мимо учёта: то есть
-- даст ровно тот сигнал «ключом пользуется кто-то ещё», ради которого она и
-- заведена. Через месяц ложных тревог на неё перестанут смотреть.

ALTER TABLE vendor_usage ALTER COLUMN task_id DROP NOT NULL;

-- Чем дедуплицировать локальный прогон, у которого нет задачи. Идентификатор
-- даёт машина: отчёт может уехать дважды при обрыве связи, и повтор не должен
-- удваивать расход — ровно та же причина, по которой дедуплицируется задача.
ALTER TABLE vendor_usage ADD COLUMN IF NOT EXISTS run_id TEXT;

-- ⚠️ Дедупликация расходится на ДВА индекса, и это не аккуратность, а
-- необходимость: NULL в уникальном индексе Postgres считает РАЗЛИЧНЫМИ.
-- Оставь мы один индекс по (task_id, service_id, unit), у локальных строк
-- защита от повторного отчёта исчезла бы совсем — каждый повтор ложился бы
-- новой строкой, и расход задвоился бы молча.
DROP INDEX IF EXISTS vendor_usage_once_idx;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_usage_once_idx
  ON vendor_usage (task_id, service_id, unit) WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_usage_local_once_idx
  ON vendor_usage (run_id, service_id, unit) WHERE task_id IS NULL;

-- Строка принадлежит либо задаче, либо локальному прогону — ровно одному из
-- двух. Без этого появилась бы третья категория «ни то ни другое»: без задачи
-- её не спишешь, без `run_id` не дедуплицируешь, и жила бы она незаметно.
ALTER TABLE vendor_usage DROP CONSTRAINT IF EXISTS vendor_usage_origin_chk;
ALTER TABLE vendor_usage
  ADD CONSTRAINT vendor_usage_origin_chk
  CHECK ((task_id IS NOT NULL) <> (run_id IS NOT NULL));

-- Для сверки: локальные строки в неё идут наравне с задачными, а в списание не
-- идут никогда — `usageCentsForTask` отбирает по `task_id = $1`, и NULL туда не
-- попадает сам собой.
CREATE INDEX IF NOT EXISTS vendor_usage_local_idx
  ON vendor_usage (created_at) WHERE task_id IS NULL;
