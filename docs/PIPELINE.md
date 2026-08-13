# Конвейер: обработка проектов

Сайт — оркестратор. Он следит за папками `IN`, собирает объекты для обработки и
складывает их в очередь. Байты не двигает и ничего не обрабатывает: это делают
машины с установленным `fs.manager.tauri`.

Раздел в админке — **Конвейер** (`/admin/pipeline`).

**Статусы в этом файле:** ✅ работает · 🔧 частично · ⬜ не сделано

Связанные документы:

- [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md) — как машина авторизуется и что уже умеет `POST /api/v1`
- [STORAGE_API.md](./STORAGE_API.md), [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md) — файловый контракт
- [FOLDER_STATE_SSOT_PLAN.md](./FOLDER_STATE_SSOT_PLAN.md) — почему тумблер живёт в папке проекта
- В `fs.manager.tauri`: `ideasAndTest/DISTRIBUTED_QUEUE_PLAN.md` (модель очереди со стороны машины),
  `ideasAndTest/+STATS_SCHEMA_PLAN.md` (схема статистики v1),
  `ideasAndTest/SITE_STATS_LINK_PLAN.md` (сквозной идентификатор задачи)

---

# Часть I. Что работает сейчас

## 1. Кто попадает под обработку ✅

Три условия, и все три — решения разных людей:

| условие | кто решает | где |
|---|---|---|
| `users.automation_enabled` | администратор | колонка 1 «Конвейера» |
| `projects.is_paused = FALSE` | пользователь **или** администратор | тумблер на карточке проекта |
| `projects.is_archived = FALSE` | пользователь | архив в кабинете |

Запрос — [`listWatchedProjects`](../lib/pipeline/repository.ts). Расшаренный проект
гейтится флагом **владельца**: `projects.user_id` — это владелец, а не тот, кому
дали доступ. Шаринга в БД пока нет вовсе (`group_name = 'shared'` — просто метка),
но правило написано так, что останется верным, когда он появится.

## 2. Тумблер слежения — один, в двух хранилищах ✅

`projects.is_paused` в Postgres и `options/folderState.json` на R2 — это **одно и
то же состояние** (`enabled = NOT is_paused`). Писать их по отдельности нельзя,
поэтому запись только через [`setProjectPaused`](../lib/project-automation.ts):

```
1. R2       — options/folderState.json          (источник правды)
2. Postgres — projects.is_paused                (запрашиваемое зеркало)
3. Журнал   — storage_changes: put по сайдкару  (чтобы машина узнала)
```

Порядок обязателен. R2 первым: не получилось — вышли, ничего не тронув, расхождения
нет вовсе. Журнал последним: иначе машина прочитает `delta` раньше, чем сайдкар
реально изменился. Без шага 3 запись на R2 остаётся для машины невидимой —
`getDelta` не фильтрует ключи по префиксу, поэтому `put` по `options/folderState.json`
доезжает наравне с обычными файлами.

Точки входа, все через эту функцию: `PATCH /api/projects/[id]` (кабинет),
`PATCH /api/projects/[id]/drive/folder-state`, `putSidecar kind: folder-state`
(машина), `PATCH /api/admin/pipeline/projects/[id]` (админка).

**Устаревшее `projects.is_active` удалено** (миграция `2026-08-13-pipeline-automation.sql`):
колонка дублировала смысл `is_paused` и была с ней сварена перекрёстным
присваиванием в `updateProject`, из-за чего выключение автоматизации ставило
проекту «Приостановлен», а пауза гасила автоматизацию в обход R2. Поле `isActive`
в ответах машинам **осталось** и считается как `NOT is_paused` — контракт
`POST /api/v1` не менялся, пересобирать десктоп не нужно.

## 3. Сканер: журнал вместо watcher'а ✅

Watcher'ов и обхода папок нет и не планируется. Любая запись в хранилище уже
журналируется в `storage_changes` через [`journal`](../lib/storage/write-path.ts) —
и загрузка из браузера, и `notify` от машины, и `mkdir`/`rename`/`delete`. Журнал
сквозной и упорядочен монотонным `seq`, поэтому «что нового появилось в `IN`» —
это выборка `seq > last_seq`, а не сравнение состояний.

Следствие: ни одно событие не теряется и ни одно не обрабатывается дважды, пока
курсор двигается только после обработки пачки. Курсор — `automation_scan_state.last_seq`.

Полный обход остаётся как **сверка** (по образцу `reindex`), а не как основной
механизм. ⬜ Пока не сделан.

## 4. Слежение — состояние, а не действие ✅

`automation_scan_state.is_running`. Кнопка на странице переключает флаг в базе;
фоновый цикл [`runner.ts`](../lib/pipeline/runner.ts) стартует из
[instrumentation.ts](../instrumentation.ts) и читает флаг на каждом тике (15 с).

Почему в базе, а не в памяти процесса: закрытая страница не должна останавливать
слежение, перезапуск процесса должен его возобновлять, админов несколько и все
должны видеть одно состояние. Работает потому, что приложение крутится
долгоживущим Node-процессом под pm2 (`next start`), а не в serverless — тот же
приём, что у `chat-push-poller`.

Итог тика пишется в `last_created` / `last_error` и виден в нижней полосе страницы.

## 5. Сборка объекта для обработки ✅

[`process-queue.ts`](../lib/pipeline/process-queue.ts) — порт
`src/PROCESSING/utils/createProcessQueue.ts` из `fs.manager.tauri`, алгоритм один в
один, вместе с `loop` и `spy`-нодами. Порядок шагов исполняет тот же десктопный
движок: разойдись он — обработка пойдёт не так, как автор рисовал граф.

Единственное отличие: на десктопе перед сборкой вызывается
`syncCostsFromManifest`, перезаписывающая `cost` из `plugin.json`. Реестра плагинов
на сайте нет и быть не должно, поэтому `cost` берётся таким, каким его сохранил
редактор нод, а окончательную цену считает машина.

Форма объекта — как в `findFilesForSingleFolder.ts`:

```jsonc
{
  "schemaVersion": 1,
  "processingQueue": ["mainSearch", "<stepId>", …],
  "mainSearch": { …, "output": [ /* идентичность файла */ ] },
  "<stepId>": { "id", "nodeType", "pluginId", "import", "isTerminal", …props },
  "description": { "projectId", "projectName", "ownerEmail", "findTime", "curItem", … }
}
```

**Два отличия от десктопа, обязательные к соблюдению:**

1. **Ни ссылок, ни путей.** Presigned URL живёт минуты, а задача может простоять в
   очереди часы и переретраиться на следующий день. В `output` лежит идентичность:
   `{ fileId, s3Key, name, folderPath, sizeBytes, contentHash }`. Байты машина
   берёт экшеном `presign`, когда действительно начинает работу.
2. **Ничего машинно-локального.** `programmPath`, `folderPath`, `pathAliases`,
   `localFolder`, `typeOfFile` десктоп подставляет из своих настроек — у каждой
   машины свои пути к After Effects и ffmpeg. Эти поля заполняет машина.

## 6. Какие файлы считаются подходящими 🔧

`searchExts` из узла `mainSearch` в `options.json` — список расширений.

`searchType` («video») сам по себе бесполезен: расширения к нему лежали в
настройках десктопа (`typeOfFile_store`), которых у сайта нет. Решено, что
расширения пишет сам редактор нод при сохранении графа.

⬜ **Поля пока нет.** До его появления такой проект пропускается с причиной
`no-search-exts` («пересохранить граф в программе»). Это ожидаемое поведение, а не
поломка.

## 7. Дедуп задач ✅

Частичный уникальный индекс `tasks_active_source_idx` на `(project_id, source_key)`
`WHERE status IN ('queued','claimed','running')`. Повторные `put` по одному файлу
(перезапись, `reindex`, повторный `notify`) не плодят вторую живую задачу.
Завершённые и упавшие под ограничение не попадают — по файлу можно прогнать
обработку заново.

Дедуп держит индекс, а не проверка перед вставкой: события приходят пачкой, и
проверка «нет ли уже» между чтением и вставкой ничего не гарантирует.

## 8. Страница «Конвейер» ✅

Три колонки: пользователи → проекты → файлы, плюс нижняя панель (описание,
настройки, чат) и полоса запуска, приклеенная к нижней границе.

Колонки 2 и 3 — **те же компоненты, что в кабинете пользователя**. Различие
вынесено в один объект `WorkspaceSource`
([types.ts](../components/account/workspace/types.ts)): адреса, `scopeKey`,
`splitByTab`, `chatPerspective`, `showServiceFolders`, `can`. Кабинетный источник —
[source.ts](../components/account/workspace/source.ts), админский —
[pipeline-source.ts](../components/admin/pipeline/pipeline-source.ts).

Отличия админского вида: видна служебная папка `options`, видны архивные проекты
(помечены), чат смотрится со стороны команды (`sender_type = 'team'`), из мутаций
доступна только пауза.

**Папку `options` нельзя получить снятием фильтра:** её файлов вообще нет в
`project_files` — сайдкары пишутся прямо в R2, а `reindex` пропускает этот префикс
намеренно. Папка достраивается листингом
([`listProjectServiceFiles`](../lib/project-storage.ts)).

## 9. Описание проекта ✅ / 🔧

`options/description.md` — развёрнутое описание: `kind: "description"` добавлен в
оба сайдкар-контракта, так что десктоп читает и пишет его тем же путём
(`getSidecar` / `putSidecar`). Короткое `projects.description` осталось подписью на
карточке — за ней нельзя ходить в объектное хранилище на каждый рендер списка.

⬜ Отрисовки markdown нет: markdown-зависимостей в проекте ноль, выбор библиотеки
не сделан. Пока показывается исходный текст. Отдельно: в стандартном markdown нет
подчёркивания, цвета и размера текста — либо инлайн-HTML, либо WYSIWYG.

---

# Часть II. Контракт с машинами

## 10. Что уже есть ✅

Единственная точка входа — `POST /api/v1` с телом `{ action, props, token }`,
токен `rc_…` из админки. 14 экшенов: `me`, `heartbeat`, `capabilities`, `projects`,
`tree`, `delta`, `presign`, `notify`, `mkdir`, `rename`, `deleteObject`, `reindex`,
`getSidecar`, `putSidecar`. Реестр — [registry.ts](../lib/machine-api/registry.ts).

Токен компьютера видит все проекты (как ADMIN). `online` = `lastHeartbeatAt` не
старше 90 секунд; рекомендованный интервал heartbeat — 20–30 с.

## 11. Выдача задач ⬜ — НЕ РЕАЛИЗОВАНО

Колонки в `tasks` под это уже есть (`claimed_by`, `claimed_at`, `lease_expires_at`,
`attempts`, `max_attempts`, `error`), но **кода выдачи не существует**: `claimTask`
в реестре нет, `SKIP LOCKED` в проекте не встречается. Машина сейчас физически не
может взять задачу, поэтому столбец «Машина» в окне очереди всегда пустой.

Модель согласована с `DISTRIBUTED_QUEUE_PLAN.md` (сторона машины): **pull, судья —
БД, аренда + heartbeat**. Открытый вопрос того плана «транспорт claim/complete» —
закрывается: экшены на существующем `POST /api/v1`, новых эндпоинтов, токенов и
полей в настройках не нужно.

Добавить четыре экшена:

### `claimTask`

```jsonc
// props
{ "capabilities": ["ffmpeg", "ae"] }   // опционально, на будущее
// ответ: задача или null
{ "task": { "id", "projectId", "payload", "leaseExpiresAt" } | null }
```

```sql
UPDATE tasks SET
  status = 'claimed',
  claimed_by = $computerId,
  claimed_at = NOW(),
  lease_expires_at = NOW() + interval '15 minutes',
  attempts = attempts + 1,
  updated_at = NOW()
WHERE id = (
  SELECT id FROM tasks
   WHERE status = 'queued'
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

`SKIP LOCKED` — «эту строку уже забрали, дай следующую». Из десяти машин,
дёрнувших это одновременно, строку получит ровно одна. Судья — запрос, не
оркестратор: узкого горлышка и SPOF в момент раздачи нет.

### `taskProgress`

```jsonc
{ "taskId", "stepId", "status": "running|done|error", "message": "…" }
```

Двигает шаг в `task_progress` (⬜ таблицы ещё нет, см. §13), продлевает аренду и
переводит задачу в `running` при первом шаге.

### `taskDone` / `taskFailed`

```jsonc
{ "taskId", "outFiles": ["OUT/clip_01.mp4"], "totalCost": 0.09 }
{ "taskId", "error": "ffmpeg exit 1" }
```

`taskDone`: `status = 'done'`, `payload = '{}'` (см. §16), строки `task_progress`
удаляются. `taskFailed`: `status = 'failed'`, **`payload` сохраняется** — без него
нельзя ни переретраить, ни разобраться.

### Сборщик протухших аренд ⬜

Машина умерла — аренда истекла — задача возвращается в `queued`, если попыток
осталось. Вешается на тот же тик `runner.ts`:

```sql
UPDATE tasks SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
       claimed_by = NULL, lease_expires_at = NULL, updated_at = NOW()
 WHERE status IN ('claimed','running') AND lease_expires_at < NOW();
```

Нужен индекс, иначе это скан таблицы:

```sql
CREATE INDEX tasks_lease_idx ON tasks (lease_expires_at)
  WHERE status IN ('claimed', 'running');
```

### Мелочи, которые всплывут при реализации

- `remote_computers.current_task` — свободный `TEXT`. Для продления аренды удобнее
  `current_task_id TEXT REFERENCES tasks(id)`: «какую задачу держит машина» станет
  связью, а не строкой, которую надо парсить.
- `remote_computers.status` ограничен `CHECK (status IN ('idle','busy','error'))`.
  Захочется различать «качает» и «обрабатывает» — расширять миграцией.

---

# Часть III. Чего ещё нет

## 12. Прогресс выполнения ⬜

Отдельная таблица, самоочищающаяся: появилась задача — шаги видны, завершилась —
исчезли.

```sql
CREATE TABLE task_progress (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id    TEXT NOT NULL,
  step_label TEXT NOT NULL,
  status     TEXT NOT NULL,     -- pending | running | done | error
  message    TEXT,
  started_at TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ
);
```

Шаги пишутся **при создании задачи** — они уже известны, `processingQueue` собран.
Машина потом только двигает `status`. Так цепочка видна сразу целиком, а не
появляется по одному шагу, и понятно, где всё стоит.

`ON DELETE CASCADE` — и есть самоочистка: удалили задачу, ушёл её прогресс,
отдельный сборщик мусора не нужен.

## 13. Полные логи, несколько дней ⬜

Повторяем окно `LOG_WIN` десктопа. Там за двумя вкладками стоят **три** хранилища
с разным временем жизни:

| ярус | в программе | на сайте |
|---|---|---|
| живое | RAM hot-buffer: активные + последние 40 завершённых (`HOT_BUFFER_FINISHED_LIMIT = 40`) | `tasks` + `task_progress`, фильтр по активным статусам |
| полные логи, дни | файлы `app_data_dir/logs/YYYY-MM-DD.jsonl`, подгружаются по клику | `task_log` с вытеснением по времени |
| финальный архив | `options/_stats/$YYYY.$MM.jsonl` | таблица §14 |

Иерархия отображения в программе четырёхуровневая: главная папка → проект → item →
шаг. На сайте первый уровень становится **пользователем**: пользователь → проект →
задача → шаг.

Грабля из `LOG_WIN/STRUCTURE.md`, которую надо учесть при импорте: в архивных
файлах `errorCount` всегда 0, потому что Rust пишет группу в том виде, в котором
она пришла на `emit_item_start`, а инкрементит только renderer в памяти
(`effectiveCounts` пересчитывает счётчики на чтении). Значит счётчики не храним, а
считаем запросом — иначе затащим нули.

Размер под контролем вытеснением: 1000 item в день × 50 строк × 200 Б ≈ 10 МБ/день,
за неделю ~70 МБ. Чистку вешать на тот же тик `runner.ts`.

## 14. Глобальный архив статистики ⬜

Зеркало схемы v1 из `+STATS_SCHEMA_PLAN.md`, поле в поле. Схема там **заморожена**,
и в плане прямо записано: «`database-sync` / онлайн-БД — пуш этой же схемы на
удалённый URL. Схема v1 = готовый payload под это».

```sql
CREATE TABLE processing_stats (
  item_id       TEXT PRIMARY KEY,      -- ключ дедупа, см. §15
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  schema_version INTEGER NOT NULL,
  status        TEXT NOT NULL,         -- done | error
  project_name  TEXT NOT NULL,
  main_folder   TEXT NOT NULL,
  cur_item      TEXT NOT NULL,
  in_type       TEXT,
  out_type      TEXT,
  registered_at TIMESTAMPTZ,           -- нашли файл
  started_at    TIMESTAMPTZ,           -- старт обработки
  ended_at      TIMESTAMPTZ,
  out_sec       INTEGER,               -- хронометраж результата
  render_sec    INTEGER,               -- endedAt − startedAt, без времени очереди
  out_paths     JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost    NUMERIC(12, 6),
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Агрегаты не храним — считаем запросом, как и в плане десктопа. Платно/бесплатно =
`status = 'done' AND total_cost > 0`; ошибку не тарифицируем.

### Как записи попадают на сайт

`_stats` лежит по пути `$projectPathGD/options/_stats/$YYYY.$MM` → `.jsonl`, и если
проект под облачным зеркалом, к имени дописывается машина:
`2026.08.alexeys-imac.jsonl`. Причина в комментарии Rust: в объектном хранилище нет
дописывания в конец, заливка перезаписывает объект целиком, и две машины на одном
файле затрут строки друг друга тихо и задним числом.

Значит на сайте это **склейка N файлов на проект**. Курсор на каждый файл, потому
что JSONL только дописывается:

```sql
CREATE TABLE stats_import_state (
  s3_key         TEXT PRIMARY KEY,   -- …/options/_stats/2026.08.alexeys-imac.jsonl
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lines_imported INTEGER NOT NULL DEFAULT 0,
  etag           TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`etag` меняется при каждом дописывании — по нему видно, есть ли смысл скачивать
файл вообще. Файлы разных машин не мешают друг другу: у каждого свой ключ и свой
курсор, а склейка получается сама, потому что строки летят в одну таблицу.

Вставка — `ON CONFLICT (item_id) DO NOTHING`. Строки в JSONL иммутабельны,
обновлять нечего.

Искать файлы нечем новым не надо: `_stats` внутри `options/`, а листинг этого
префикса уже сделан для колонки 3 (`listProjectServiceFiles`).

**Чтение файлов, а не пуш — базовый путь.** Файлы уже пишутся, схема заморожена, в
программе менять нечего, и они же остаются резервной копией у пользователя.
`database-sync` (`storage.onlineDb` в настройках десктопа, сейчас заглушка без
Rust-обработчика) добавляется позже как ускорение: приёмник тот же, `ON CONFLICT
DO NOTHING` тот же, поэтому одновременная работа обоих путей дублей не даёт.

## 15. Сквозной идентификатор задачи ⬜

Без него у нас две несвязанные идентичности: задача, которую создал сайт, и запись
в архиве, которую создала машина. Связать постфактум можно только по совпадению
«проект + имя файла + время», то есть гаданием.

Сейчас `itemId` генерирует машина в `db_register_found`
(`settings_commands.rs:462`) из `pathForDelete` + `findTime`, а `pathForDelete` —
**локальный путь**, разный на каждой машине.

Решение: сайт при сборке задачи кладёт свой `task.id` в `description.dbItemId`
(поле уже существует), а `db_register_found` использует переданный id вместо
генерации. Тогда `item_id` в `processing_stats` равен id задачи, и «эта задача
завершилась вот такой записью» — связь, а не догадка.

Правка на стороне десктопа — план `ideasAndTest/SITE_STATS_LINK_PLAN.md` в
`fs.manager.tauri`. **Делать до импорта, а не после.**

---

# Часть IV. Эксплуатация

## 16. Размеры и вытеснение

Дороже всего в `tasks` — `payload`: 5–25 КБ на задачу (цепочка 5–15 шагов по
0,4–2 КБ), в 25 раз больше всего остального в строке. После успешного завершения
он бесполезен: это была инструкция для машины, машина её выполнила.

| что | 100 тыс. задач | 500 тыс. задач |
|---|---|---|
| строка с `payload` | ~1 ГБ сырых, ~250 МБ сжатых TOAST | ~5 ГБ / ~1,3 ГБ |
| строка без `payload` | ~40 МБ + ~20 МБ индексы | ~200 МБ + ~100 МБ |

Отсюда правило: `taskDone` затирает `payload` в `'{}'`, `taskFailed` сохраняет.
Тогда сотни тысяч задач — это десятки-двести мегабайт, и вопрос места снимается.

⬜ **Отдельно: `storage_changes` не чистится никогда.** `CHANGE_RETENTION_DAYS = 90`
в [changes.ts](../lib/storage/changes.ts) используется только для вычисления флага
`truncated`; `DELETE FROM storage_changes` в проекте не встречается. Это ~350–400 Б
на каждую файловую операцию, и растёт с каждой перезаписью. При сотнях тысяч файлов
чистку старше 90 дней надо завести раньше, чем упрёмся. Курсор конвейера не
пострадает: он всегда стоит на голове журнала, а не в хвосте.

## 17. Что нужно для запуска

1. Применить миграции (`npm run db:migrate`).
2. **Перезапустить процесс** — `runner.ts` поднимается только из
   `instrumentation.ts` при старте.
3. Включить нужных пользователей в колонке 1 (по умолчанию включены все).
4. Нажать «Запустить слежение».

Задачи появятся, когда в папке `IN` отслеживаемого проекта окажется файл
подходящего типа. Пустая очередь при отсутствии событий — правильное поведение.

Разовый прогон для диагностики — `POST /api/admin/pipeline/collect`: только он
показывает, какие проекты пропущены и почему (`no-options`, `no-search-exts`,
`no-main-search`, `invalid-options`, `no-match`, `already-queued`). В интерфейсе
этой кнопки нет.

## 18. Вне объёма

Обсуждено и сознательно не делается сейчас: перенос reactFlow в админку, превью
медиафайлов (браузер закрывает почти всё через presigned GET; серверные превью
нужны только для ProRes/MXF/DNxHD и PSD), реализация шаринга проектов в БД, журнал
списаний по балансу (`cost` уже доезжает в `payload`, таблицы нет).
