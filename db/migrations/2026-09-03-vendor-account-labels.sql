-- Метка учётки уникальна В ПРЕДЕЛАХ ВЛАДЕЛЬЦА, а не сервиса целиком.
--
-- Прежний `UNIQUE (service_id, label)` был верен, пока учётки заводили только
-- мы. С клиентским экраном «Мои ключи» (VENDOR_KEYS_CLIENT_REQUESTS, 7.1) он
-- ломается на втором же человеке: первый назвал свою учётку `main`, и второму
-- это имя занято — при том что учётки чужие друг другу и не пересекаются нигде.
--
-- `COALESCE(owner_user_id, '')` вместо простого списка колонок: NULL в
-- уникальном индексе Postgres считает различными, и с обычным
-- `(service_id, owner_user_id, label)` две НАШИ учётки с меткой `main` прошли бы
-- обе — ровно та защита, ради которой индекс и заведён, исчезла бы у
-- платформенных.
--
-- Разрешение учётки при выдаче от этого не страдает: сайт сначала ищет учётку
-- владельца задачи и только потом платформенную (`issueKeysForMachine`), так
-- что совпадение меток у разных людей ни к какой двусмысленности не ведёт.
DROP INDEX IF EXISTS vendor_accounts_label_idx;
ALTER TABLE vendor_accounts
  DROP CONSTRAINT IF EXISTS vendor_accounts_service_id_label_key;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_accounts_owner_label_idx
  ON vendor_accounts (service_id, COALESCE(owner_user_id, ''), label);
