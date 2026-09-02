-- Отзыв тестового периода и повторная выдача (BILLING_AND_TRIAL_PLAN П9.1).
--
-- Миграция ничего не включает: колонки появляются пустыми, у всех живых
-- грантов `reset_at IS NULL`, и замок «один период на человека» продолжает
-- держать ровно то же, что держал до неё. Меняется только его условие.

ALTER TABLE billing_grants
  ADD COLUMN IF NOT EXISTS reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Замок остаётся в базе — там же, где был, и по той же причине: он должен
-- пережить удаление проектов, архив и корзину. Но держит он теперь не «период
-- когда-либо был», а «период есть сейчас».
--
-- Условие именно `reset_at IS NULL`, а не `status IN ('provisioning','active')`:
-- второе выглядит проще, но тогда у любого, чей период просто кончился, кнопка
-- загорается сама, и период становится бесконечным для всех. Сброс обязан быть
-- следом человека в базе (`reset_by`, `reset_at`), а не побочным эффектом
-- смены статуса.
DROP INDEX IF EXISTS billing_grants_trial_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS billing_grants_trial_once_idx
  ON billing_grants (user_id) WHERE kind = 'trial' AND reset_at IS NULL;

-- Под запрос «сколько периодов было у этого человека»: сброшенные строки
-- остаются, и по их числу считается номер следующей попытки («период №2» в
-- списке активаций). Общий billing_grants_user_idx сюда не годится — он не
-- отбирает по виду подарка, а трайлов среди них меньшинство.
CREATE INDEX IF NOT EXISTS billing_grants_trial_reset_idx
  ON billing_grants (user_id, created_at) WHERE kind = 'trial';
