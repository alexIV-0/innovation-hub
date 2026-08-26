# Задание: убрать дублирование и наследие

Документ — **техническое задание на исполнение**, не отчёт. Составлен по разбору
кода на 2026-08-25 (ветка `UI_dev`, версия пакета `0.1.2`).

**В коде ничего не менялось.** Каждый пункт содержит: что происходит, чем
доказано, что делать, чего не делать и как проверить результат.

Четыре независимые задачи, можно брать в любом порядке и любым числом людей:

| | Задача | Зачем | Риск |
| --- | --- | --- | --- |
| **A** | Свести две поверхности storage API в одну логику | **исправляет 8 расхождений в поведении** — это баги, а не стиль | низкий |
| **B** | Убрать «Идеи» целиком | сущность больше не нужна; сейчас это вторая копия «Видео» | средний (миграция БД) |
| **C** | Убрать старую генерацию экранов кабинета | два набора экранов делают одно и то же; ~3700 строк | низкий |
| **D** | Убрать наследие Google Drive | интеграции нет с момента перехода на R2 | низкий (кроме §D.3) |

Подробный контекст по каждой подсистеме — в
[docs/reference/](./reference/README.md).

---

## Общие правила для всех четырёх задач

1. **Отдельная ветка и отдельный коммит на задачу.** Задачи A–D не пересекаются
   по файлам, кроме одного места: задача C удаляет legacy-страницы кабинета,
   которые в задаче D упоминаются как читатели drive-колонок. Если делаете обе —
   сначала C, потом D.
2. **Прогонять после каждой задачи:**
   ```bash
   npx tsc --noEmit          # ⚠️ сейчас сборка НЕ падает на типах, см. §E.1
   npm run i18n:check
   npm run md:check
   npm run build
   ```
3. **Миграции только новым файлом** в `db/migrations/` с датой в имени.
   `db/schema.sql` править **тоже** (он идемпотентный и используется для
   `db:init` с нуля) — иначе новая установка получит удалённое обратно.
4. **После миграции — перезапуск процесса.** Пул `pg` кеширует планы запросов;
   без `pm2 reload all` живой сервер отдаёт
   `cached plan must not change result type`.
5. **Не переименовывать публичные пути API** в рамках этих задач. Переименование
   ломает десктоп-клиент и парк машин; это отдельная согласованная работа
   (см. §D.3).
6. Проверка «ничего не отвалилось» для UI — руками по чеклисту в конце
   документа. Тестов в проекте нет.

---

# Задача A. Свести две поверхности storage API

## A.1. Что происходит

Одни и те же операции над файлами реализованы **дважды**:

| Поверхность | Файлы | Кто ходит |
| --- | --- | --- |
| REST | `app/api/storage/v1/*/route.ts` | десктоп-клиент `fs.manager.tauri` (токен `mch_…`), браузер (сессия) |
| RPC | `lib/machine-api/actions/storage-*.ts`, точка входа `POST /api/v1` | машины парка (токен `rc_…`) |

Схема валидации, проверка доступа, вызов доменной функции и разбор ошибок в семи
операциях **скопированы построчно**. Копии уже разъехались.

Это предсказанное последствие, и оно прямо описано в коде — там, где так делать
не стали:

> `lib/pipeline/queue-endpoint.ts`: «Тот же приём, что у общих словарей — одна
> логика, тонкие обёртки, иначе поверхности разъедутся.»

## A.2. Таблица расхождений

### Активные — наблюдаются сегодня

| № | Операция | REST (`/api/storage/v1/…`) | RPC (`POST /api/v1`) | Следствие |
| --- | --- | --- | --- | --- |
| 1 | `mkdir` | принимает `ensurePath` и создаёт всю цепочку родителей через `writeEnsureFolderPath` ([`mkdir/route.ts:12-19,50-65`](../app/api/storage/v1/mkdir/route.ts)) | поля не знает ([`storage-write.ts:171-209`](../lib/machine-api/actions/storage-write.ts)) | машина парка не может создать вложенный путь одним вызовом, десктоп по REST — может |
| 2 | `notify` | `fileName` уходит в запись **как есть** | оборачивает в `safeBaseFileName(data.fileName)` | один и тот же файл получает **разное имя в каталоге** в зависимости от поверхности: `отчёт (1).pdf` против `отчёт_1.pdf` |
| 3 | `notify` | статус берётся из ошибки: `error.status` | захардкожен `409` | недопустимое имя (400, повтором не лечится) приезжает как 409 «занято»; клиент решает, что надо переименовать и повторить, — и повторяет вечно |
| 4 | `copy` | перед постановкой задания создаёт строку папки назначения (`writeEnsureFolderPath`), с комментарием «без неё скопированное поддерево не покажется в дереве проекта» | не создаёт | **копирование папки через RPC даёт поддерево, невидимое в дереве проекта** |
| 5 | `delta` | в ответе есть `settingsRevision` — по нему клиент бесплатно узнаёт, что общие словари изменились | поля нет | машина на RPC не узнаёт об изменении словарей из `delta` и должна опрашивать `getSettings` отдельно |
| 6 | `getSidecar` | GET отдаёт `etag`, `sizeBytes`, `lastModified` | отдаёт только `{ key, body }` | **машина на RPC не может сделать условную запись**: `putSidecar` принимает `ifMatch`, но взять `etag` ей негде |
| 7 | `sidecars` PUT | актор записи — `{ userId: auth.userId }`, то есть `isUploader` по умолчанию **true** | `actorFromAuth(auth)`, у `rc_`-машины `isUploader: false` | машина парка, записавшая сайдкар по REST, **забирает себе `uploaded_by`** — прямо против правила, записанного в `lib/storage/write-path.ts` («машина возвращает результаты в проект и заливщиком не считается») |
| 8 | `rename` | требование «нужно `name` и/или `folderPath`» проверяется **вручную после** разбора схемы | то же требование в `.refine()` внутри схемы | разные текст и форма ошибки на одинаковый некорректный запрос |

### Латентные — сегодня совпадают, потому что RPC принимает только `rc_`-токены (а у них роль `ADMIN`)

| № | Операция | REST | RPC | Почему важно |
| --- | --- | --- | --- | --- |
| 9 | `reindex` | `requireOwnedProjectAccess` (только владелец) | `requireEditableProjectAccess` (editor и выше) | одна операция, два правила доступа. Разойдётся, как только RPC начнёт принимать сессию или `mch_` |
| 10 | `sidecars` PUT | `requireOwnedProjectAccess` | `requireEditableProjectAccess` | то же |
| 11 | `reindex` | `projectId` берётся из query **или** из тела; стоит `maxDuration = 120` | только из `props` | разные способы вызова одной операции |
| 12 | `copy` | при неизвестной ошибке отдаёт общее `"Copy failed."` | отдаёт `error.message` | RPC выносит наружу внутренние тексты ошибок |

### Пробел, а не расхождение

| Операция | REST | RPC |
| --- | --- | --- |
| Корзина: `GET /trash`, `POST /trash/restore` | есть | **экшенов нет вообще** |

При этом `capabilities` рапортует `trash: true` обеим поверхностям
([`lib/storage/capabilities.ts`](../lib/storage/capabilities.ts)). То есть RPC
обещает возможность, которой у него нет.

### Копии без расхождений (дублируется только обвязка)

`presign`, `object` / `deleteObject`, `tree`, `multipart/create`,
`multipart/presign-part`, `multipart/complete`, `multipart/abort`, `jobs/:id`.

## A.3. Как в проекте уже сделано правильно

Пять доменов вынесены в общий модуль, и роут с экшеном там — тонкие обёртки. **Это
образец, повторять его.**

| Домен | Общий модуль | Расхождений |
| --- | --- | --- |
| Очередь задач | `lib/pipeline/queue-endpoint.ts` | нет |
| Общие словари | `lib/settings-endpoint.ts` | нет |
| Проекты (создать / переименовать / состояние / удалить / восстановить) | `lib/storage/project-mutations.ts` + `project-catalog.ts` | нет |
| Multipart | `lib/storage/multipart.ts` (схемы + функции) | нет |
| Корзина, копирование, фоновые работы | `lib/storage/{trash,copy,jobs}.ts` | нет |

Форма, к которой стоит привести (как в `project-mutations.ts`):

```ts
export type MutationError = { error: string; status: number }
export type MutationOk<T> = { data: T }
export type MutationResult<T> = MutationOk<T> | MutationError
```

Роут переводит это в `NextResponse.json`, экшен — в `apiOk`/`apiError`. Схема
объявляется **один раз** и импортируется обеими сторонами.

## A.4. Что делать

**Шаг 0 — согласовать правильное поведение.** Для каждого пункта 1–8 решить, чья
версия верна. Предварительные рекомендации:

| № | Рекомендация |
| --- | --- |
| 1 | `ensurePath` нужен обеим — это восстановление возможности для машин |
| 2 | **обсудить с автором десктоп-клиента.** Санитайз имени меняет то, что человек видит в дереве; отказ (текущее поведение REST) честнее, но клиент должен его ожидать |
| 3 | верна версия REST (`error.status`) |
| 4 | верна версия REST (создавать папку) |
| 5 | `settingsRevision` нужен обеим |
| 6 | `etag` нужен обеим, иначе `ifMatch` бесполезен |
| 7 | верна версия RPC (`actorFromAuth`) |
| 8 | верна версия RPC (`.refine()` в схеме — ошибка тогда единообразна) |
| 9,10 | выбрать одно правило. `editor` выглядит правильнее: переиндексация и запись сайдкара — это работа в проекте, а не распоряжение папкой |

**Шаг 1 — создать общие модули.** Предлагаемая раскладка:

```
lib/storage/endpoints/
  presign.ts     schema + handler
  notify.ts
  mkdir.ts
  rename.ts
  delete-object.ts
  reindex.ts
  sidecars.ts    get + put
  tree.ts        + delta.ts   (чтобы settingsRevision был в одном месте)
```

**Шаг 2 — переписать роуты** на вызов общего модуля, сохранив HTTP-контракт:
пути, методы, имена полей ответа. Изменения статусов — только те, что
согласованы на шаге 0.

**Шаг 3 — переписать экшены** через `defineAction(sharedSchema, sharedHandler)`.

**Шаг 4 — добавить экшены корзины** (`trash`, `trashRestore`) либо убрать
`trash: true` из `capabilities`. Первое лучше: логика уже в
`lib/storage/trash.ts`.

**Шаг 5 — дописать карточки** в `lib/machine-api/catalog.ts` для новых экшенов.
Реестр сверяется с каталогом при загрузке модуля в dev-режиме и напишет в
консоль расхождение в обе стороны — этим и проверяется.

## A.5. Чего не делать

- Не менять пути и имена полей ответа без согласования: на другом конце
  десктоп-клиент и парк машин.
- Не сливать `lib/machine-api/catalog.ts` с `lib/machine-api/registry.ts`.
  Каталог импортирует клиентский компонент страницы `/admin/remote-access/api`, а
  реестр тянет обработчики и через них `pg`. Причина разделения записана в
  комментарии в `registry.ts`.
- Не трогать `lib/storage/write-path.ts`. Там лежат инварианты (уборка сирот,
  запрет заливки канонических сайдкаров, атрибуция) — задача про обвязку, не про
  них.

## A.6. Как проверить

```bash
# 1. Реестр и каталог сошлись — в dev-консоли нет предупреждений [machine-api]
npm run dev

# 2. Пара REST/RPC даёт одинаковый результат. Для каждой из 7 операций
#    выполнить оба варианта на тестовом проекте и сравнить и тело, и статус.
```

Отдельно проверить руками сценарии из таблицы:

- [ ] `mkdir` с `ensurePath: "a/b/c"` — обе поверхности создают три папки
- [ ] `notify` с именем `тест (1).pdf` — обе дают одинаковое имя в дереве
- [ ] `notify` с именем `a:b.pdf` — обе дают один и тот же статус
- [ ] копирование папки через RPC — поддерево **видно** в дереве проекта
- [ ] `delta` через RPC содержит `settingsRevision`
- [ ] `getSidecar` через RPC отдаёт `etag`, и с ним проходит `putSidecar` с `ifMatch`
- [ ] запись сайдкара машиной `rc_` по REST **не меняет** `uploaded_by`
- [ ] корзина доступна с RPC (или `capabilities` больше не обещает `trash`)

---

# Задача B. Убрать «Идеи» целиком

## B.1. Контекст от владельца продукта

Изначальный замысел: на главной странице сайта две закладки — готовые видео и
рядом «Идеи», то есть то, что ещё не реализовали. По сути одна и та же сущность с
разной меткой.

**Публично это никогда не было выпущено** — в коде публичного сайта (`app/page.tsx`,
`app/video/*`, `components/videos/*`, `components/header.tsx`) нет ни одного
упоминания идей. Сущность живёт только в админке.

**Решение: идеи не нужны, убрать полностью.**

## B.2. Что сейчас есть

`videos` и `ideas` — структурно **одинаковые** таблицы; `VideoRecord` и
`IdeaRecord` в `lib/domain-types.ts` — идентичные типы. Продублированы таблица,
репозиторий, схемы, роуты и карточки UI.

Побочное доказательство, что это одна сущность: админский экран уже склеивает их
в один список с дискриминатором (`ContentItem = { kind: "video" | "idea", data }`
в `components/admin/admin-types.ts`), а диалог умеет **конвертировать** запись из
одного вида в другой (`convertedToVideo` / `convertedToIdea` в
`components/admin/data/admin-data-context.tsx`).

Из дублирования уже вытекли два расхождения — их можно не исправлять, они уйдут
вместе с идеями:

| | видео | идеи |
| --- | --- | --- |
| `revalidateTag("published-videos")` при мутации | есть | **нет** |
| `reorder-bulk` (порядок после перетаскивания) | есть | нет |

## B.3. Порядок работ

**Сначала — снять данные.** До удаления таблицы:

```sql
SELECT COUNT(*) FROM ideas;
SELECT COUNT(*) FROM ideas WHERE is_published;
```

Если строки есть и они нужны — выгрузить (`pg_dump -t ideas`) и приложить дамп к
задаче. Если среди них есть то, что должно стать видео, — перенести
`INSERT INTO videos SELECT … FROM ideas WHERE …` **до** удаления.

**Шаг 1 — удалить файлы полностью:**

| Файл | Строк с идеями |
| --- | --- |
| `app/api/admin/ideas/route.ts` | весь файл |
| `app/api/admin/ideas/[id]/route.ts` | весь файл |
| `app/api/admin/ideas/reorder/route.ts` | весь файл |
| `lib/repositories/ideas.ts` | весь файл (36 вхождений) |
| `components/admin/admin-idea-card.tsx` | весь файл |
| `components/admin/overview/overview-recent-ideas.tsx` | весь файл |
| `lib/public-data.ts` | весь файл — **и так мёртвый**, ноль импортов |

**Шаг 2 — вычистить упоминания:**

| Файл | Что убрать |
| --- | --- |
| `lib/domain-types.ts` | тип `IdeaRecord` |
| `lib/content-types.ts` | тип `IdeaCardItem` |
| `lib/admin-schemas.ts` | `ideaCreateSchema` и родственные (3 вхождения) |
| `components/admin/admin-types.ts` | `ContentKind` → остаётся один вид; `AdminIdea`; `kind` в `ContentDraft` и `emptyContentDraft` |
| `components/admin/content/content-types.ts` | `ContentKindFilter` — убрать вариант `"ideas"` (и, если фильтр остаётся с одним значением, убрать сам фильтр) |
| `components/admin/data/admin-data-context.tsx` | 20 вхождений: состояние `ideas`, запрос `/api/admin/ideas`, `patchIdea`, `confirmDeleteIdea`, ветки `draft.kind === "video" ? … : …`, конвертация вида |
| `components/admin/content/content-content.tsx` | склейка `videos + ideas` в `allItems`, фильтр по виду |
| `components/admin/content/content-grid.tsx` | ветка отрисовки карточки идеи |
| `components/admin/admin-content-dialog.tsx` | переключатель вида и конвертация |
| `components/admin/overview/overview-content.tsx` | блок «свежие идеи» |
| `components/admin/overview/overview-quick-actions.tsx` | действие «создать идею» |
| `components/admin/overview/overview-stats.tsx` | плитка со счётчиком идей (6 вхождений) |
| `components/admin/shell/admin-sidebar.tsx` | `videos.length + ideas.length` — **но файл сам мёртвый**, см. §C.6; проще удалить файл |
| `components/admin/admin-dict.ts` | 25 ключей: `ideaAdded`, `ideaUpdated`, `ideaDeleted`, `ideaUpdateError`, `kindIdea`, `convertedToIdea` и остальные — в обоих языках |
| `components/account/i18n.tsx` | строка `"Videos and ideas in one curated stream…"` — переформулировать в оба языка |
| `scripts/db-init.mjs` | `sampleIdeas`, `seedIdeas()`, её вызов, `DROP TABLE ideas`/`"Idea"` в блоке пересоздания |
| `scripts/migrate-object-storage-to-r2.mjs` | `UPDATE ideas …` (строка 370) |

**Шаг 3 — миграция БД.** Новый файл `db/migrations/2026-XX-XX-drop-ideas.sql`:

```sql
DROP TABLE IF EXISTS ideas CASCADE;
```

И убрать из `db/schema.sql`: `CREATE TABLE ideas`, `ideas_published_sort_idx`,
`ideas_tags_gin`, а также относящиеся к идеям `UPDATE ideas …` в конце файла
(13 вхождений).

Существующие миграции **не править** — они уже применены:
`2026-07-27-fix-absolute-media-urls.sql` и
`2026-07-31-normalize-storage-media-urls.sql` содержат `UPDATE ideas`, и после
`DROP TABLE` они на новой установке упадут. Поэтому либо обернуть их содержимое в
проверку существования таблицы, либо (проще и честнее) в новой миграции удалять
таблицу, а в `schema.sql` её не создавать — тогда на чистой установке старые
миграции применяются к уже созданной `schema.sql`… **проверить порядок:**
`db:init` наливает `schema.sql`, `db:migrate` применяет миграции. Если
`schema.sql` больше не создаёт `ideas`, старые миграции с `UPDATE ideas` упадут
на чистой установке. Рабочее решение — в старых миграциях заменить
`UPDATE ideas …` на блок с проверкой:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ideas') THEN
    UPDATE ideas SET …;
  END IF;
END $$;
```

Это единственное допустимое изменение в уже применённых миграциях: оно не меняет
их эффект там, где они прошли.

**Шаг 4 — упростить то, что осталось.** После удаления идей:

- `ContentItem` с дискриминатором становится не нужен — экран контента работает
  с одним типом;
- фильтр по виду в `content-filter-pills.tsx` теряет смысл;
- имя `revalidateTag("published-videos")` остаётся корректным.

## B.4. Как проверить

- [ ] `/admin/content` открывается, список видео полный, поиск и фильтр по
      статусу и категории работают
- [ ] создание, правка, удаление и **перетаскивание порядка** видео работают
- [ ] `/admin` (обзор) открывается, плитки и «свежие работы» на месте
- [ ] главная страница сайта не изменилась
- [ ] `grep -rni "\bidea" app components lib db scripts` даёт только
      `ideasAndTest/` в комментариях и `"Your idea"` в форме предложений
- [ ] `npm run i18n:check` проходит
- [ ] на чистой базе: `pnpm db:init && pnpm db:migrate` проходит без ошибок

---

# Задача C. Убрать старую генерацию экранов кабинета

## C.1. Что это такое — простыми словами

Кабинет переписывали. Сначала он был набором обычных страниц: страница со списком
проектов, страница одного проекта, страница чата, дашборд. Потом его заменили
**рабочей областью** — одним экраном с колонкой проектов, деревом файлов и нижней
панелью, где всё переключается без перехода по адресам.

**Старые страницы не удалили.** Сейчас в кабинете живут два набора экранов,
которые делают одно и то же:

| Что показывает | Старый экран | Новый экран |
| --- | --- | --- |
| Список проектов | `/account/projects` → `projects-section.tsx` | `/account/projects` → `workspace/*` |
| Один проект: файлы, описание, настройки, чат | `/account/projects/{id}` | `/account/projects?id={id}` |
| Чат проекта | `/account/projects/{id}/chat` | нижняя панель, закладка «Чат» |
| Дашборд | `/account/dashboard` | `/account` |

Обратите внимание на первую строку: адрес `/account/projects` **один**, и его уже
занял новый экран. Поэтому `projects-section.tsx` (887 строк) не открывается
вообще ниоткуда — он мёртв полностью.

## C.2. Чем доказано, что это две генерации, а не одна система

**Кто на что ссылается** (проверено поиском по всему репозиторию):

```
components/account/sections/projects-section.tsx   ← НИКТО. Ноль импортов.

app/account/dashboard/page.tsx  →  sections/dashboard-section.tsx
   кто открывает /account/dashboard:
   только components/auth/register-form.tsx:67 — редирект после регистрации

app/account/projects/[id]/page.tsx  →  sections/project-detail-section.tsx
   кто ставит ссылки на /account/projects/{id}:
   только sections/dashboard-section.tsx:305
   и    sections/create-project-button.tsx:77
   то есть ссылаются друг на друга внутри старой генерации

app/account/projects/[id]/chat/page.tsx  →  sections/project-chat-panel.tsx
   кто ставит ссылку:
   только sections/project-detail-section.tsx:435
```

**Боковое меню кабинета** (`components/account/workspace-shell.tsx`) ведёт на
`/account` (дашборд), `/account/projects?tab=…` (разделы рабочей области),
`/account/profile`, `/account/statistics`. На `/account/dashboard` и на
`/account/projects/{id}` **не ведёт никуда**.

Практическое следствие, которое стоит проверить руками: **зарегистрируйте нового
пользователя.** `register-form.tsx:67` отправит его на `/account/dashboard`, то
есть в старый кабинет. Все остальные попадают в новый.

## C.3. Что удалить

Страницы:

| Файл |
| --- |
| `app/account/dashboard/page.tsx` |
| `app/account/dashboard/loading.tsx` |
| `app/account/projects/[id]/page.tsx` |
| `app/account/projects/[id]/loading.tsx` |
| `app/account/projects/[id]/chat/page.tsx` |

Компоненты (все — только из старой генерации, проверено):

| Файл | Строк | Кто ссылался |
| --- | --- | --- |
| `components/account/sections/projects-section.tsx` | 887 | никто |
| `components/account/sections/project-detail-section.tsx` | 1073 | удаляемая страница |
| `components/account/sections/project-chat-panel.tsx` | 472 | удаляемые страница и компонент |
| `components/account/sections/dashboard-section.tsx` | 393 | удаляемая страница |
| `components/account/sections/create-project-button.tsx` | 148 | только `dashboard-section` |
| `components/account/sections/project-automation-panel.tsx` | 78 | только `project-detail-section` |
| `components/account/shell/account-page-header.tsx` | 32 | только старая генерация |
| `lib/hooks/use-poll-unread-counts.ts` | 41 | только `dashboard-section` и `projects-section` |

Итого около **3100 строк компонентов** и ~600 строк страниц.

## C.4. Что изменить

**`components/auth/register-form.tsx:62-68`** — редирект после регистрации.
Сейчас:

```ts
const target =
  data.redirectTo && data.redirectTo.startsWith("/") && !data.redirectTo.startsWith("//")
    ? data.redirectTo
    : "/account/dashboard"
```

Фолбэк заменить на `/account`. Заодно проверить, что отдаёт сервер:
`app/api/auth/signup/route.ts` возвращает `redirectTo: "/account"` — то есть
фолбэк срабатывает только если поле потерялось, но именно он и ведёт в старый
кабинет.

**`components/account/workspace/source.ts:30-31`** — `uploadUrl` кабинета
указывает на `/api/projects/{id}/media`, а этот роут на POST отвечает **410**
(«загрузка через сервер отключена»). Кабинет туда не ходит: в
`workspace-context.tsx:274-281` для `scopeKey === "cabinet"` вызывается
`uploadProjectFileDirect` (presign → PUT → notify). То есть это мёртвая
конфигурация, ведущая на заглушку. Либо убрать поле из `CABINET_SOURCE` (тогда
сделать его необязательным в типе `WorkspaceSource`), либо оставить с явным
комментарием — но не оставлять как есть.

## C.5. Чего не удалять

| Файл | Почему остаётся |
| --- | --- |
| `components/account/dashboard-page.tsx` | это **текущий** дашборд, `/account`, на него ведёт боковое меню |
| `components/account/options/exposed-options.tsx` | используется и рабочей областью — `workspace/bottom-panel.tsx:14` |
| `components/account/options/option-controls.tsx` | зависимость предыдущего |
| `components/account/stats-readiness.tsx` | используется обеими витринами статистики |
| `components/account/resize-grip.tsx`, `use-drag-size.ts` | используются рабочей областью, инструментами и админским «Конвейером» |
| `components/account/use-project-counts.ts` | используется `workspace-shell.tsx` |

## C.6. Что становится мёртвым как следствие

После удаления старой генерации перестают использоваться:

| Что | Где | Чем доказано |
| --- | --- | --- |
| `GET/POST /api/projects/[id]/messages` | роут целиком | из UI не вызывается уже сейчас |
| `lib/repositories/project-messages.ts` | модуль целиком | только этот роут |
| Таблица `project_messages` | БД | после удаления модуля читателей нет |
| `listProjectsByOwner` | `lib/repositories/projects.ts:46` | **ноль вызовов уже сейчас**, и это единственное место, где ещё читается `project_messages` |
| `listProjectMedia` | `lib/repositories/projects.ts` | только `app/account/projects/[id]/page.tsx` |
| `countMediaByUserId` | там же | только `app/account/dashboard/page.tsx` |
| `findProjectMedia`, `createProjectMedia`, `deleteProjectMedia`, `deleteProjectMediaByDriveFileId` | там же | **ноль вызовов уже сейчас** — в таблицу `project_media` никто не пишет |
| Таблица `project_media` | БД | после удаления функций читателей нет |
| `DELETE /api/projects/[id]/media/[mediaId]` | роут | только `project-detail-section.tsx:320`. Дублирует `DELETE /api/projects/[id]/drive/files/[fileId]` |
| `GET /api/projects/[id]/media` | роут | клиентов нет уже сейчас. Читает `project_files`, а не `project_media` — то есть имя роута обманчиво |
| `components/admin/shell/admin-topbar.tsx` | компонент | ноль импортов (не связано с кабинетом, просто заодно) |
| `components/admin/shell/admin-sidebar.tsx` | компонент | ноль импортов; заменён `workspace-shell.tsx` |

**Порядок для второго прохода** (можно отдельным коммитом):

1. удалить роуты `messages`, `media`, `media/[mediaId]`;
2. удалить `lib/repositories/project-messages.ts` и функции `project_media` из
   `lib/repositories/projects.ts`, плюс `listProjectsByOwner`;
3. миграция: `DROP TABLE IF EXISTS project_messages;` и
   `DROP TABLE IF EXISTS project_media;` — **сначала проверив
   `SELECT COUNT(*)`** по обеим;
4. убрать их из `db/schema.sql`;
5. убрать типы `ProjectMessageRecord`, `MessageSenderRole`, `ProjectMediaRecord`
   из `lib/domain-types.ts`;
6. убрать `createMessageSchema` из `lib/project-schemas.ts`.

⚠️ **Не путать `project_messages` с `project_chat_messages`.** Второй — живой
чат с двусторонней синхронизацией с YouGile, его трогать нельзя. Признаки:
`project_messages` имеет `sender_role` (`user`/`team`) и флаги
`read_by_user`/`read_by_team`; `project_chat_messages` имеет `sender_type`
(`client`/`team`/`system`) и `yougile_message_id`.

## C.7. Как проверить

- [ ] `/account` — дашборд открывается, график и плитки работают
- [ ] `/account/projects` — рабочая область, все пять разделов `?tab=`
- [ ] выбор проекта, дерево файлов, загрузка файла с прогрессом
- [ ] нижняя панель: превью, описание, настройки, чат — все четыре закладки
- [ ] чат проекта: отправка сообщения, значок непрочитанного
- [ ] **регистрация нового пользователя** ведёт в рабочую область, а не на
      `/account/dashboard`
- [ ] `/account/dashboard` и `/account/projects/{id}` отдают 404 (или, если так
      решено, редиректят в рабочую область)
- [ ] `/admin/pipeline` — колонка 3 работает: она использует те же компоненты
      рабочей области
- [ ] `npx tsc --noEmit` не прибавил ошибок

---

# Задача D. Убрать наследие Google Drive

## D.1. Контекст

Проект начинался с хранения файлов в Google Drive. Потом перешли на Cloudflare
R2. Переход состоялся, Drive в рантайме **не используется**, но следы остались в
трёх разных видах, и их нужно разделять — цена и риск у них разные.

## D.2. Мёртвый код и зависимости — убирать смело

| Файл | Строк | Чем доказано |
| --- | --- | --- |
| `lib/google-drive.ts` | ~700 | ноль импортов. **Единственный потребитель пакета `googleapis`** |
| `lib/project-drive.ts` | ~30 | ноль импортов; упоминается только в комментарии `project-detail-section.tsx:965`, который сам удаляется задачей C |
| `lib/provision-drive.ts` | ~12 | ноль импортов |

Зависимость `googleapis` после этого снимается из `package.json` — самый заметный
выигрыш по размеру установки.

Скрипты — оставить, но не в общем каталоге либо с явной пометкой «одноразовые,
Drive»: `scripts/google-drive-oauth.mjs`, `scripts/drive-provision-users.mjs`,
`scripts/migrate-drive-to-r2.mjs`. Они не участвуют в рантайме; удалять историю
миграции не обязательно, но `package.json` содержит для них скрипты
`drive:oauth` и `drive:provision-users` — их стоит убрать из списка команд, чтобы
не выглядели действующими.

Переменные `GOOGLE_DRIVE_*` в `.env.example` уже помечены «legacy one-time
migration only» — после удаления `lib/google-drive.ts` их можно убрать совсем.

⚠️ **Не путать с `lib/google-oauth.ts`** — это вход через Google, он **живой** и
используется на `/login` и `/register`. Переменные `GOOGLE_CLIENT_ID` и
`GOOGLE_CLIENT_SECRET` нужны.

## D.3. Имена, которые обманывают — отдельное решение, не в этой задаче

Эти места работают с R2, но называются Drive. Переименование ломает клиентов,
поэтому это **отдельная согласованная работа**, а не часть чистки:

| Что | Где | Почему трогать нельзя без согласования |
| --- | --- | --- |
| Путь `/api/projects/[id]/drive`, `/drive/files/[fileId]`, `/drive/folder-state`, `/drive/options` | 4 роута + `app/api/admin/pipeline/projects/[id]/drive` | адреса зашиты в `WorkspaceSource` двух зон, а сам путь публичный |
| Тип `DriveFile` | **136 вхождений в 13 файлах** рабочей области | механическое переименование, но большое; лучше отдельным коммитом «только rename», чтобы диff читался |
| `driveUrl` в `WorkspaceSource` | `types.ts`, `source.ts`, `pipeline-source.ts` | вместе с путями |

Рекомендация: переименовать `DriveFile` → `StorageFile` и `driveUrl` → `treeUrl`
отдельным коммитом без других изменений; пути API оставить как есть до
согласования с автором десктоп-клиента.

## D.4. Колонки и поля БД

| Что | Состояние | Что делать |
| --- | --- | --- |
| `users.drive_folder_id` | читается (`PUBLIC_USER_FIELDS`), **пишется нигде**: `setUserDriveFolderId` в `lib/repositories/users.ts:272` имеет ноль вызовов | снять после задачи C |
| `projects.drive_folder_id` | читается и отдаётся в API как `driveFolderId`; **пишется нигде**: `setProjectDriveFolderId` в `lib/repositories/projects.ts:230` имеет ноль вызовов | см. предупреждение ниже |
| `project_media.drive_file_id` | уходит вместе с таблицей в задаче C | — |
| `driveFolderId` в ответе `GET /api/projects` | `app/api/projects/route.ts:75,102` | убирать вместе с колонкой; проверить, не читает ли поле десктоп-клиент |
| `driveFileId: null` / `""` в ответах | `api/projects/[id]/media/route.ts`, удаляемые страницы | уходит с задачей C |

⚠️ **Про `projects.drive_folder_id` есть нюанс.** На колонке висит частичный
уникальный индекс `projects_drive_folder_id_idx`, и в `db/schema.sql` к нему
приложен комментарий: он ставился, чтобы два параллельных запроса не создали
дубли проектов при upsert по папке Drive. Механизм больше не работает
(`listUserProjectsFromDrive` из `lib/project-drive.ts` мёртв), но **перед
удалением колонки проверьте, что в ней не осталось значимых данных**:

```sql
SELECT COUNT(*) FROM projects WHERE drive_folder_id IS NOT NULL;
SELECT COUNT(*) FROM users    WHERE drive_folder_id IS NOT NULL;
```

Если значения есть — это соответствие «проект ↔ папка на Drive», единственная
связь со старым хранилищем. Прежде чем удалять, убедитесь, что папки на Drive
больше не нужны (файлы перенесены в R2 скриптом
`migrate-drive-to-r2.mjs`). При сомнении — выгрузить соответствие в файл и
приложить к задаче.

Миграция после проверки:

```sql
DROP INDEX IF EXISTS projects_drive_folder_id_idx;
ALTER TABLE projects DROP COLUMN IF EXISTS drive_folder_id;
ALTER TABLE users    DROP COLUMN IF EXISTS drive_folder_id;
```

Плюс убрать поля из `db/schema.sql`, из `ProjectRecord` и `UserRecord` в
`lib/domain-types.ts`, из `PROJECT_FIELDS` и `PUBLIC_USER_FIELDS`, из
`Project` в `components/account/workspace/types.ts` и `mapProject` в
`format.ts`.

## D.5. Как проверить

- [ ] `npm run build` проходит, `googleapis` больше нет в `package.json`
- [ ] `/account/projects` — список проектов и дерево файлов работают
- [ ] загрузка, переименование, удаление, перемещение файла
- [ ] `/admin/pipeline` — все три колонки
- [ ] `GET /api/storage/v1/projects` отдаёт корректный каталог (проверить с
      десктоп-клиентом, если поле `driveFolderId` убирали из ответов)
- [ ] `grep -rn "google-drive\|provision-drive\|project-drive" app components lib`
      — пусто

---

# E. Что осталось за рамками этих четырёх задач

Перечислено, чтобы не выглядело забытым. Подробный разбор —
[docs/reference/14-improvements.md](./reference/14-improvements.md).

## E.1. `typescript.ignoreBuildErrors: true`

`next.config.mjs` отключает падение сборки на ошибках типов при
`strict: true` в `tsconfig.json`. Это влияет на **все четыре задачи выше**:
удаление кода не будет поймано компилятором на этапе `npm run build`.

**Перед началом любой задачи выполните `npx tsc --noEmit` и запишите текущее
число ошибок** — иначе не отличить свои от уже существующих.

## E.2. Дубли хелперов

`formatBytes` / `fmtSize` — 6 копий; `jsonError` — 3; `decodeFileNameHeader` — 2;
`safeNextPath` — 2. Отдельно: `getClientIp` в `lib/rate-limit.ts` и
`readClientIp` в `app/api/visitors/track/route.ts` **ведут себя по-разному** —
второй читает `cf-connecting-ip`, первый нет. За Cloudflare rate limit увидит не
тот IP, что трекинг.

Часть копий (`formatBytes` в `project-detail-section.tsx`) исчезнет с задачей C.

## E.3. Политики загрузки

`lib/s3-upload-policy.ts` и `lib/project-upload-policy.ts` содержат одну и ту же
таблицу «расширение → MIME», скопированную построчно.
`lib/public-upload-policy.ts` сделан правильно — реэкспортирует общее и добавляет
свои лимиты. Это образец.

## E.4. Заглушки, выглядящие рабочими

`/api/feature-suggestions` и `/api/video-orders` валидируют вход и отдают **503**
(`TODO(yougile)`). При этом `/api/feature-suggestions/upload` **работает** и
складывает вложения в R2 — пользователь загружает файлы, получает отказ на
заявку, а объекты остаются в бакете, и удалить их нечем.

## E.5. Неиспользуемые примитивы UI

21 файл в `components/ui` не импортируется нигде (~2020 строк), и вместе с ними в
`dependencies` висят `vaul`, `react-day-picker`, `embla-carousel-react`,
`input-otp`, `react-resizable-panels`, `@radix-ui/react-toast` (у последнего нет
даже файла-потребителя) и ещё 12 пакетов `@radix-ui/react-*`.

Держать неиспользуемые примитивы shadcn — нормальная практика, они подтягиваются
CLI по мере надобности. Решение за владельцем кода: либо удалить файлы вместе с
пакетами, либо оставить и сознательно.

## E.6. Cron-роуты

`/api/cron/storage-jobs` и `/api/cron/storage-purge` оба чистят корзину, функция
`authorize` скопирована в оба файла, а второй дублирует последовательность
часового тика `lib/statistics/stats-loop.ts` вместо вызова той же функции.

## E.7. Обвязка разбора тела

В 32 route-файлах повторяется один и тот же блок «разобрать JSON → zod → 400», и
формат ошибки уже не везде одинаковый: часть роутов отдаёт
`{message, errors: flatten()}`, часть — только первый `issue`.

---

# Чеклист приёмки

```
Задача A — storage API
□ npx tsc --noEmit: число ошибок не выросло
□ в dev-консоли нет предупреждений [machine-api] о расхождении реестра и каталога
□ восемь сценариев из §A.6 дают одинаковый результат на обеих поверхностях
□ решение по каждому из пунктов 1–8 зафиксировано (комментарием или в задаче)

Задача B — идеи
□ данные из таблицы ideas сняты или сознательно отброшены
□ /admin/content и /admin работают
□ grep по "idea" даёт только ideasAndTest/ и "Your idea"
□ на чистой базе db:init + db:migrate проходят

Задача C — старый кабинет
□ регистрация нового пользователя ведёт в рабочую область
□ все экраны кабинета из §C.7 работают
□ /admin/pipeline колонка 3 работает
□ project_messages и project_chat_messages не перепутаны

Задача D — Drive
□ googleapis снят с зависимостей
□ данные drive_folder_id проверены перед удалением колонок
□ вход через Google (/login) работает
□ десктоп-клиент видит каталог проектов

Общее
□ npm run build
□ npm run i18n:check
□ npm run md:check
□ pm2 reload all после миграций
□ docs/reference/ обновлён там, где менялось поведение
```
