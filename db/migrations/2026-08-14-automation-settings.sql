-- Общие словари: типы файлов с расширениями, цвета типов нод и типов данных,
-- пользовательские маски путей. Подробно — docs/SETTINGS_SYNC.md.
--
-- Зачем в БД, а не сайдкаром на R2: словарь один на всю систему обработки, а
-- options/ лежит внутри проекта — там он размножился бы по числу проектов, и
-- «добавить .mov в video» означало бы перезапись файла во всех сразу. Плюс у R2
-- нет ни транзакций, ни ревизий, то есть нельзя ответить «твоя версия устарела»,
-- а без этого слияние идёт вслепую.
--
-- Синглтон по образцу automation_scan_state: словарь принадлежит системе
-- обработки, а не клиенту, который заливает файлы в проект. «video = mp4, mov»
-- и цвет ноды ffmpeg — конвенция оператора, одна на всех. Понадобится
-- мультиарендность — добавляется owner_id, протокол при этом не меняется.

CREATE TABLE IF NOT EXISTS automation_settings (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  -- Растёт на КАЖДУЮ запись, даже если содержимое не изменилось: это счётчик
  -- версии для оптимистической блокировки, а не хеш состояния.
  revision   BIGINT NOT NULL DEFAULT 1,
  domains    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT automation_settings_singleton_chk CHECK (id = 'singleton')
);

-- Пустой документ. Дефолты наливает сид (lib/repositories/automation-settings.ts
-- → seedDefaults), а не миграция: там же лежит нормализация цветов, и держать
-- два списка дефолтов в разных местах — гарантированное расхождение.
INSERT INTO automation_settings (id, revision, domains)
VALUES ('singleton', 1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
