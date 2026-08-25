-- Инструменты пользователя: экземпляры из каталога (lib/tools/registry.ts).
--
-- Каталог живёт в коде, а не здесь: у инструмента есть интерфейс, значит новый
-- инструмент — это всё равно деплой, и таблица только добавила бы расхождение
-- между «есть запись» и «есть код».
--
-- settings — параметры экземпляра (какие проекты скрыть в выпадающем списке,
-- раскладка папок, языки). source — что подключено (проект и папка задачи).
-- Для локального режима путь тут не хранится намеренно: доступ к папке живёт
-- в браузере, на сервер не уходит (docs/DIALOG_FORMAT.md, docs/TOOLS_SRT_EDITOR_PLAN.md §4).
CREATE TABLE IF NOT EXISTS user_tools (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_key       TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  source         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_tools_owner_idx
  ON user_tools (user_id, sort_order, created_at)
  WHERE deleted_at IS NULL;
