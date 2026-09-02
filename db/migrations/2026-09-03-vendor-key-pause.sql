-- Проект остановлен из-за отсутствующего ключа внешнего сервиса
-- (VENDOR_KEYS_CLIENT_REQUESTS, пункт 5).
--
-- Третья причина паузы рядом с денежными. Отдельная, а не «no-funds», потому
-- что действие человека разное: при нехватке денег он пополняет баланс, здесь —
-- подключает ключ на «Моих ключах» либо ждёт, пока это сделаем мы. Свести их в
-- одну означало бы показать ему кнопку «пополнить» там, где деньги ни при чём.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_paused_reason_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_paused_reason_check
  CHECK (paused_reason IN ('no-funds', 'trial-over', 'no-vendor-key'));
