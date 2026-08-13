-- Конвейер: слежение — это состояние, а не одноразовое действие.
--
-- Кнопка на странице переключает не «собрать задачи сейчас», а «следить за
-- папками IN и создавать объекты для обработки». Значит состояние обязано жить
-- в базе, а не в памяти процесса и уж точно не в браузере:
--
--   — закрытая страница не должна останавливать слежение;
--   — перезапуск процесса (deploy, pm2 reload) должен его возобновлять;
--   — админов несколько, и все должны видеть одно и то же состояние.
--
-- Фоновый цикл читает is_running на каждом тике (lib/pipeline/runner.ts), поэтому
-- запуск и остановка — это просто UPDATE, без сигналов в процесс.

ALTER TABLE automation_scan_state
  ADD COLUMN IF NOT EXISTS is_running BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE automation_scan_state
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Кто включил. ON DELETE SET NULL, а не RESTRICT: удаление админа не должно
-- блокироваться из-за того, что он когда-то запускал конвейер.
ALTER TABLE automation_scan_state
  ADD COLUMN IF NOT EXISTS started_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Итог последнего тика — чтобы на странице было видно, что цикл живой и что
-- он делает, не открывая логи сервера.
ALTER TABLE automation_scan_state
  ADD COLUMN IF NOT EXISTS last_created INTEGER NOT NULL DEFAULT 0;

ALTER TABLE automation_scan_state
  ADD COLUMN IF NOT EXISTS last_error TEXT;
