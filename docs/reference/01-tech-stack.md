# 01 — Технологии: что использовано и для чего

Каждая позиция — с ответом на «зачем именно это». Версии — из `package.json` на
дату сверки; менеджер пакетов `pnpm@10.33.2`, но в `deploy` используется
`npm ci` (см. [13 — Эксплуатация](./13-operations.md)).

---

## 1. Каркас

| Технология | Версия | Зачем |
| --- | --- | --- |
| **Next.js** | 16.2.4 | App Router, серверные компоненты, route handlers. Один процесс отдаёт и HTML, и API — отдельного бэкенда нет. Работает долгоживущим Node-процессом под pm2 (`next start`), а не в serverless: от этого зависят фоновые циклы (см. [02](./02-architecture.md#6-фоновые-циклы)). |
| **React** | 19.2.3 | серверные компоненты по умолчанию, `"use client"` — точечно. |
| **TypeScript** | 5.7.3, `strict: true` | ⚠️ `next.config.mjs` ставит `typescript.ignoreBuildErrors: true` — сборка не падает на типах. Это техдолг, а не решение (см. [14](./14-improvements.md)). |
| **Turbopack** | `next dev --turbo` | быстрый дев-сервер. |

Алиас путей — один: `@/*` → корень репозитория (`tsconfig.json`).

### Рантаймы

Почти все роуты объявляют `runtime = "nodejs"`: они трогают Postgres (`pg`),
S3-клиент или `web-push`, и ни то, ни другое не работает в Edge. Единственное
исключение — `proxy.ts`, где стоит только проверка JWT через `jose` (она
Edge-совместима), а обращение к базе намеренно вынесено в layout.

---

## 2. Данные

| Технология | Зачем |
| --- | --- |
| **PostgreSQL** через **`pg`** 8.20 | единственная база. ORM нет: запросы пишутся руками в `lib/repositories/*` и `lib/storage/*`. Причина — SQL здесь нетривиальный (`FOR UPDATE SKIP LOCKED` в очереди, частичные индексы, оконные агрегаты статистики), и ORM его бы только спрятал. |
| **пул `pg.Pool`** | `lib/db.ts`: один пул на процесс, `PG_POOL_MAX` по умолчанию небольшой. Там же — вся логика TLS (см. [13](./13-operations.md#2-переменные-окружения)). |
| **`withTransaction`** | `lib/db.ts` — обёртка над `BEGIN/COMMIT/ROLLBACK`. Путь записи в хранилище (`lib/storage/write-path.ts`) весь идёт через неё: строка каталога и запись в журнал обязаны появляться вместе. |
| **`zod`** 3.24 | валидация **каждого** входящего тела. Схемы живут отдельно от роутов (`lib/*-schemas.ts`), потому что одну схему делят несколько поверхностей. |

Миграции — обычные `.sql`-файлы в `db/migrations/`, накат — `scripts/db-migrate.mjs`.
`db/schema.sql` идемпотентен (`CREATE TABLE IF NOT EXISTS` + `ALTER … ADD COLUMN
IF NOT EXISTS`), поэтому его можно прогонять на живой базе.

---

## 3. Объектное хранилище

| Технология | Зачем |
| --- | --- |
| **Cloudflare R2** через **`@aws-sdk/client-s3`** | все файлы проектов, медиа витрины, вложения, архив статистики. R2 — потому что нет платы за исходящий трафик, а API S3-совместимый. |
| **`@aws-sdk/s3-request-presigner`** | presigned PUT/GET. Байты **никогда не идут через сервер приложения** в пользовательском пути: браузер и машины грузят напрямую в бакет. Исключение — `/api/admin/upload`, где поток проксируется, чтобы не требовать CORS на бакете. |
| **`@aws-sdk/lib-storage`** (`Upload`) | потоковая многочастная заливка на стороне сервера для двух проксирующих роутов. |

Особенности S3-клиента (`lib/s3-client.ts`): flexible checksums отключены, иначе
`x-amz-checksum-*` попадают в `SignedHeaders` и presigned PUT из браузера падает
подписью после того, как тело уже доехало.

---

## 4. Интерфейс

| Технология | Зачем |
| --- | --- |
| **Tailwind CSS** 3.4 | всё оформление классами. Своих `.css`-файлов два: `app/globals.css` (токены, палитра описаний, типографика markdown) и неиспользуемый `styles/globals.css`. |
| **`tailwindcss-animate`** | keyframes для Radix-анимаций (аккордеон и т.п.). |
| **shadcn/ui** (`components.json`) | генератор компонентов поверх Radix. Компоненты копируются в репозиторий и правятся руками — библиотеки в зависимостях нет. |
| **Radix UI** (~25 пакетов) | доступные примитивы: диалог, поповер, селект, меню, тултип. Даёт фокус-трапы, роли и клавиатуру бесплатно. ⚠️ ~половина установленных пакетов не используется (см. [14](./14-improvements.md#4-мёртвый-код-и-лишние-зависимости)). |
| **`lucide-react`** | иконки. `optimizePackageImports` в конфиге переписывает barrel-импорты, чтобы в чанк не попадала вся библиотека. |
| **`class-variance-authority` + `clsx` + `tailwind-merge`** | `cn()` в `lib/utils.ts` — склейка классов с корректным разрешением конфликтов Tailwind. |
| **`sonner`** | тосты. Монтируется один раз в `app/layout.tsx`. |
| **`framer-motion`** | только `components/landing/motion-reveal.tsx` — появление секций на публичном сайте. В рабочих зонах движения нет. |
| **`react-hook-form` + `@hookform/resolvers`** | формы авторизации и публичные формы; те же zod-схемы, что на сервере. |
| **`@dnd-kit/*`** | drag-and-drop порядка видео в админке. |
| **`recharts`** | графики статистики (`components/statistics/statistics-explorer.tsx`, `components/ui/chart.tsx`). |
| **`cmdk`** | комбобокс тегов (`components/ui/tag-combobox.tsx`). |
| **`next-themes`** | только для `useTheme()` внутри `components/ui/sonner.tsx`. Тема у сайта одна — тёмная; `ThemeProvider` нигде не смонтирован. |

### Шрифты

Три семейства через `next/font/google` — self-hosted, без запроса к Google:

- **Inter** (`--font-inter`) — основной текст, `font-sans`;
- **Space Grotesk** (`--font-space-grotesk`) — заголовки, `font-display`;
- **IBM Plex Sans** (`--font-ibm-plex`) — рабочие зоны `/account` и `/admin`,
  подключается в их layout'ах с подмножествами `latin` + `cyrillic`.

---

## 5. Markdown и документы

| Технология | Зачем |
| --- | --- |
| **`unified` + `remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-raw` + `rehype-sanitize`** | конвейер описания проекта. Порядок критичен: `remark-gfm` → `rehype-raw` → `rehype-sanitize`. Санитайз обязателен на рендере, а не только при сохранении: файл приходит из внешней программы. |
| **`react-markdown`** | тот же конвейер в браузере — просмотрщик `components/markdown/markdown-view.tsx`. |
| **`hast-util-to-html`** | markdown → HTML для загрузки в редактор «как выглядит». |
| **Tiptap 3** (`@tiptap/react`, `starter-kit`, `extension-table`, `-image`, `-highlight`, `-list`) | режим правки описания в отрисованном виде. Схема расширений повторяет закрытый список HTML из контракта. |
| **`mermaid`** 11 | блок-схемы из ```mermaid-фенсов. Импортируется **динамически** (`await import("mermaid")`) — иначе тянет ~сотни КБ в основной чанк. |

Подробности формата — `docs/DESCRIPTION_FORMAT.md`, устройство — [09](./09-tools.md#часть-iii-описание-проекта-markdown).

---

## 6. Аутентификация и связь с внешним миром

| Технология | Зачем |
| --- | --- |
| **`jose`** | подпись и проверка JWT сессии (HS256). Выбран вместо `jsonwebtoken`, потому что работает в Edge-рантайме, где живёт `proxy.ts`. |
| **`bcryptjs`** | хеши паролей, 10 раундов. |
| **Google OAuth 2.0** (руками, без библиотеки) | `lib/google-oauth.ts` — три запроса: authorize → token → userinfo. Полноценная библиотека для одного провайдера не нужна. |
| **`googleapis`** | ⚠️ только `lib/google-drive.ts`, который **нигде не импортируется**. Наследие Drive-эпохи. |
| **`resend`** | письма: приглашение в проект и уведомление о выданном доступе. |
| **`web-push`** | push-уведомления о новых сообщениях чата. Service worker — `public/sw.js`, минимальный: только `push` и `notificationclick`, без офлайн-кеша. |
| **`pg`** → YouGile | интеграции с YouGile нет библиотеки: `lib/yougile.ts` ходит `fetch` в `https://yougile.com/api-v2`. |

---

## 7. Инструментальное

| Технология | Зачем |
| --- | --- |
| **`dotenv`** | скрипты в `scripts/` читают `.env` сами — они запускаются вне Next. |
| **`playwright-core`** | только `scripts/generate-promo-poster.mjs` — снять постер из промо-видео. В рантайме не участвует. |
| **`postcss` + `autoprefixer`** | сборка Tailwind. Лежат в `dependencies`, хотя это build-time (см. [14](./14-improvements.md)). |
| **свои проверки** | `scripts/i18n-check.mjs` — ищет захардкоженные русские строки в локализуемых зонах; `scripts/description-format-check.mts` — сверяет формат описания с контрактом. Оба запускаются вручную (`npm run i18n:check`, `npm run md:check`), в CI не подключены. |

Линтера и тестов в проекте нет: `npm run lint` вызывает `next lint`, конфигурации
ESLint в репозитории не лежит; тестового раннера нет вообще.

---

## 8. Инфраструктура

| Компонент | Роль |
| --- | --- |
| **pm2** (`ecosystem.config.json`) | процесс `ffworks` в `fork`-режиме, 1 инстанс, `max_memory_restart: 1G`. Один инстанс — не случайность: фоновые циклы и `lib/rate-limit.ts` держат состояние в памяти процесса. |
| **nginx** (`deploy/nginx-ffworks.conf`) | reverse proxy на `127.0.0.1:3000`, `client_max_body_size 100m`, проброс `X-Forwarded-For` и `X-Forwarded-Proto` (от них зависят трекинг IP, rate limit и определение redirect_uri для Google). HTTPS накидывается `certbot --nginx`. |
| **`vercel.json`** | только `installCommand`. Признак того, что деплой на Vercel пробовали; продакшен — VPS + pm2. |
| **`instrumentation.ts`** | хук Next, срабатывает один раз при старте процесса. Поднимает три фоновых цикла и сидирует общие словари. |

---

## 9. Полный список зависимостей рантайма

Ниже — всё из `dependencies`, сгруппировано. Пометка «не используется» означает
ноль импортов в `app/`, `components/`, `lib/`, `scripts/` на дату сверки.

**Каркас:** `next`, `react`, `react-dom`.

**Данные:** `pg`, `zod`, `bcryptjs`, `jose`.

**Хранилище:** `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`,
`@aws-sdk/s3-request-presigner`.

**UI-примитивы (Radix), используются:** `react-accordion`, `react-alert-dialog`,
`react-avatar`, `react-collapsible`, `react-dialog`, `react-dropdown-menu`,
`react-label`, `react-popover`, `react-select`, `react-slider`, `react-slot`,
`react-switch`, `react-toggle`, `react-tooltip`.

**UI-примитивы (Radix), не используются:** `react-aspect-ratio`,
`react-checkbox`, `react-context-menu`, `react-hover-card`, `react-menubar`,
`react-navigation-menu`, `react-progress`, `react-radio-group`,
`react-scroll-area`, `react-separator`, `react-tabs`, `react-toast`,
`react-toggle-group`.

**UI-прочее:** `lucide-react`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `tailwindcss-animate`, `sonner`, `framer-motion`, `cmdk`,
`recharts`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`,
`react-hook-form`, `@hookform/resolvers`, `next-themes`.

**UI, не используются:** `embla-carousel-react` (карусель),
`react-day-picker` (календарь), `input-otp`, `react-resizable-panels`, `vaul`
(drawer).

**Markdown:** `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`,
`rehype-raw`, `rehype-sanitize`, `react-markdown`, `hast-util-to-html`,
`mermaid`, `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`,
`@tiptap/extension-table`, `@tiptap/extension-image`,
`@tiptap/extension-highlight`, `@tiptap/extension-list`.

**Внешние сервисы:** `resend`, `web-push`, `googleapis` (только в мёртвом файле).

**Сборка (лежит в `dependencies`, хотя build-time):** `autoprefixer`.

Что из этого можно снять и почему — [14 — Что улучшить](./14-improvements.md#зависимости).
