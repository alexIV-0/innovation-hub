-- Журнал действий админов. Этап 2 плана docs/ADMIN_ROLES_PLAN.md.
--
-- Заводится вместе с разделением ролей, а не после: запреты без журнала
-- бессмысленны наполовину. Запретить можно, а узнать, кто что сделал, — нет.
--
-- actor_email продублирован строкой намеренно. Актора могут удалить, а запись
-- «кто это сделал» обязана пережить его аккаунт: ON DELETE SET NULL строку
-- сохранит, но без почты она станет нечитаемой.
--
-- meta — JSONB и намеренно без схемы: набор полей у «сменили роль» и «выпустили
-- токен» общего почти не имеет, а заводить колонку под каждое действие значит
-- переделывать таблицу при каждом новом типе события.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Лента всегда читается «сначала свежее», отсюда DESC в основном индексе.
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

-- «Что делал вот этот человек» — второй по частоте вопрос после ленты.
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON admin_audit_log (actor_id, created_at DESC);

-- «Что происходило с этим аккаунтом / компьютером / проектом».
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log (target_type, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;
