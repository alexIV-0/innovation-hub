# Remote Access API

Документация для приложения автоматизации (удалённый компьютер).

Каноническая спецификация живёт в админке: **Удалённый доступ → API** (`/admin/remote-access/api`). Этот файл — краткий обзор.

Связанные документы (веб-кабинет и user machine tokens `mch_…`):

- Файловый CRUD / sync: [STORAGE_API.md](./STORAGE_API.md)
- Контракт sync: [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md)
- Как машина будет получать задачи на обработку: [PIPELINE.md](./PIPELINE.md).
  Экшенов `claimTask` / `taskProgress` / `taskDone` в списке ниже **ещё нет** —
  они спроектированы, но не реализованы; см. PIPELINE.md §11.

---

## Назначение

1. Админ в панели **Удалённый доступ** создаёт сущность **Компьютер** и получает токен `rc_…`.
2. Агент на машине шлёт **только** `POST /api/v1` с этим токеном в теле запроса.
3. Позже планировщик задач будет распределять проекты между online-машинами, опираясь на heartbeat.

---

## Получение токена

1. Войти в админку под ролью `ADMIN`.
2. Раздел **Удалённый доступ** → **Подключить компьютер**.
3. Указать имя (и опционально описание).
4. Скопировать токен — он показывается **один раз**.

Ротация: в меню компьютера → **Обновить токен** (старый сразу перестаёт работать).  
Отзыв: **Отключить**.

Программный CRUD токенов (только сессия админа):

| Method | Path | Описание |
|---|---|---|
| `GET` | `/api/admin/computers` | Список компьютеров |
| `POST` | `/api/admin/computers` | Создать → `{ id, name, token }` |
| `PATCH` | `/api/admin/computers/:id` | Имя / описание |
| `DELETE` | `/api/admin/computers/:id` | Отозвать |
| `POST` | `/api/admin/computers/:id/rotate-token` | Новый токен once |

---

## Контракт: `POST /api/v1`

Единственная точка входа для внешних машин. Другие методы → `405`.  
Старые `/api/remote/v1/*` отвечают `410`.

```http
POST /api/v1
Content-Type: application/json

{
  "action": "heartbeat",
  "props": { "status": "idle" },
  "token": "rc_…"
}
```

| Поле | Тип | Обязательно |
|---|---|---|
| `action` | string | да |
| `props` | object | нет (по умолчанию `{}`) |
| `token` | string (`rc_…`) | да — ключ машины из админки |

### Порядок проверок

1. **Auth** — `token` есть и валиден (иначе `401`, props не смотрятся).
2. **Props valid** — `action` известен, `props` проходит схему этого action (иначе `400`).
3. **Execute** — вызывается функция action, результат возвращается как JSON.

Ошибки:

| Status | Meaning |
|---|---|
| `400` | Невалидный JSON / неизвестный action / неверные props |
| `401` | Нет / неверный / отозванный токен |
| `403` | Аккаунт создателя неактивен или операция запрещена |
| `404` | Компьютер, проект или файл не найден |
| `409` | Конфликт (дубликат имени, нет объекта в R2, ETag) |
| `503` | Хранилище не настроено / сбой R2 |

---

## Actions

Полные схемы props, примеры и ответы — в админке.

### Компьютер

| action | Назначение |
|---|---|
| `me` | Идентичность и состояние |
| `heartbeat` | Присутствие; опционально `status`, `currentProjectId`, `currentTask`, `meta` |

**online** = `lastHeartbeatAt` не старше **90 секунд** и токен не отозван.  
Рекомендация: `heartbeat` каждые **20–30 секунд**.

### Файлы

| action | Назначение |
|---|---|
| `capabilities` | Флаги возможностей |
| `projects` | Каталог клиентов и проектов |
| `tree` | Полное дерево + `cursor` |
| `delta` | Инкремент после `since` |
| `presign` | Signed PUT/GET URL (байты напрямую в R2) |
| `notify` | Подтверждение после PUT |
| `mkdir` | Создать папку |
| `rename` | Переименовать / переместить |
| `deleteObject` | Удалить файл/папку |
| `reindex` | Полный LIST R2 vs кэш |
| `getSidecar` | Читать folder-state / options |
| `putSidecar` | Писать sidecar (`kind`: folder-state \| options \| raw) |

Токен компьютера видит все проекты (как ADMIN).

---

## Минимальный цикл агента

```text
1. Сохранить rc_… токен в конфиге агента
2. Каждые 20–30s:
     POST /api/v1  { action: "heartbeat", props: { status: "idle" }, token }
3. При получении работы:
     { action: "heartbeat", props: { status: "busy", currentProjectId, currentTask }, token }
     { action: "tree", props: { projectId }, token }
     // download IN / upload OUT: presign → PUT/GET на url → notify
     { action: "heartbeat", props: { status: "idle", currentProjectId: null, currentTask: null }, token }
4. При сбое:
     { action: "heartbeat", props: { status: "error", currentTask: "reason…" }, token }
```

---

## Admin list shape (для UI / мониторинга)

`GET /api/admin/computers` (session admin) без изменений. Поле `online` вычисляется на сервере по правилу 90 секунд.
