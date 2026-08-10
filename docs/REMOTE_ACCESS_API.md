# Remote Access API

Документация для приложения автоматизации (удалённый компьютер).

Связанные документы:

- Файловый CRUD / sync: [STORAGE_API.md](./STORAGE_API.md)
- Контракт sync: [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md)

---

## Назначение

1. Админ в панели **Удалённый доступ** создаёт сущность **Компьютер** и получает Bearer-токен `rc_…`.
2. Агент на машине использует токен для:
   - heartbeat / статуса (online, idle|busy|error, текущий проект);
   - работы с файлами проектов через `/api/storage/v1`.
3. Позже планировщик задач будет распределять проекты между online-машинами, опираясь на эти статусы.

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

## Authentication

Все запросы агента:

```http
Authorization: Bearer rc_…
```

| Префикс | Кто | Доступ к проектам |
|---|---|---|
| `rc_…` | Remote computer (флот) | Все проекты (как ADMIN) |
| `mch_…` | User machine token | Проекты владельца / scope |  
| cookie | Web UI | По роли пользователя |

Ошибки auth:

| Status | Meaning |
|---|---|
| `401` | Нет / неверный токен |
| `403` | Аккаунт создателя неактивен (для `rc_` — создавший админ) |
| `404` | Ресурс не найден |

---

## Online и статусы

| Понятие | Правило |
|---|---|
| **online** | `lastHeartbeatAt` не старше **90 секунд** и токен не отозван |
| **offline** | Нет heartbeat или heartbeat старше 90s |
| `status` | Сообщает агент: `idle` \| `busy` \| `error` |
| `currentProjectId` | Проект «в работе»; `null` — сброс |
| `currentTask` | Короткая метка операции (опционально) |
| `meta` | Произвольный JSON для планировщика |

Рекомендация: слать `POST /heartbeat` каждые **20–30 секунд** (и при смене статуса/проекта).

---

## Remote API

Base path: `/api/remote/v1`  
Только `Authorization: Bearer rc_…`.

### `GET /api/remote/v1/me`

Идентичность и текущее состояние компьютера.

**Response `200`**

```json
{
  "id": "uuid",
  "name": "render-box-1",
  "description": "",
  "status": "idle",
  "online": true,
  "currentProjectId": null,
  "currentTask": null,
  "lastHeartbeatAt": "2026-08-10T12:00:00.000Z",
  "meta": {},
  "createdAt": "2026-08-10T10:00:00.000Z"
}
```

### `POST /api/remote/v1/heartbeat`

Обновляет `lastHeartbeatAt` и опционально поля статуса.

**Body** (все поля опциональны; пустое тело = только heartbeat)

| Field | Type | Notes |
|---|---|---|
| `status` | `"idle"` \| `"busy"` \| `"error"` | |
| `currentProjectId` | string \| null | `null` сбрасывает проект; иначе должен существовать |
| `currentTask` | string \| null | до 500 символов |
| `meta` | object | заменяет предыдущий `meta` целиком, если передано |

**Example**

```http
POST /api/remote/v1/heartbeat
Authorization: Bearer rc_…
Content-Type: application/json

{
  "status": "busy",
  "currentProjectId": "project-uuid",
  "currentTask": "export-preview",
  "meta": { "progress": 0.4 }
}
```

**Response `200`**

```json
{
  "id": "uuid",
  "name": "render-box-1",
  "status": "busy",
  "online": true,
  "currentProjectId": "project-uuid",
  "currentTask": "export-preview",
  "lastHeartbeatAt": "2026-08-10T12:00:30.000Z",
  "meta": { "progress": 0.4 }
}
```

**Errors**

| Status | Meaning |
|---|---|
| `400` | Невалидный JSON / поля |
| `401` | Неверный токен |
| `404` | Компьютер отозван или `currentProjectId` не найден |

Сброс проекта:

```json
{ "status": "idle", "currentProjectId": null, "currentTask": null }
```

---

## Файлы проектов (Storage API)

Тот же Bearer `rc_…` принимается на `/api/storage/v1/*`. Полная спецификация: [STORAGE_API.md](./STORAGE_API.md).

Краткий workflow:

### Upload

1. `POST /api/storage/v1/presign` — `{ "projectId", "folderPath", "name", "contentType", "method": "PUT", ... }`
2. `PUT` байты на `uploadUrl` из ответа (напрямую в R2)
3. `POST /api/storage/v1/notify` — подтверждение; запись попадает в кэш и journal

### Download

1. `POST /api/storage/v1/presign` — `{ "method": "GET", "s3Key": "…" }` (или через tree)
2. `GET` по signed URL

### Дерево / delta / папки

| Method | Path | Назначение |
|---|---|---|
| `GET` | `/api/storage/v1/projects` | Каталог клиентов и проектов |
| `GET` | `/api/storage/v1/tree?projectId=` | Полное дерево + cursor |
| `GET` | `/api/storage/v1/delta?projectId=&since=` | Инкремент |
| `POST` | `/api/storage/v1/mkdir` | Создать папку |
| `POST` | `/api/storage/v1/rename` | Переименовать / переместить |
| `DELETE` | `/api/storage/v1/object` | Удалить файл/папку |
| `GET`/`PUT` | `/api/storage/v1/sidecars` | folder-state / options |

---

## Минимальный цикл агента

```text
1. Сохранить rc_… токен в конфиге агента
2. Каждые 20–30s:
     POST /api/remote/v1/heartbeat  { status: "idle" }   // или busy + project
3. При получении работы (от планировщика / локально):
     POST /heartbeat { status: "busy", currentProjectId, currentTask }
     GET  /api/storage/v1/tree?projectId=…
     // download IN / upload OUT через presign → PUT/GET → notify
     POST /heartbeat { status: "idle", currentProjectId: null, currentTask: null }
4. При сбое:
     POST /heartbeat { status: "error", currentTask: "reason…" }
```

Пример заголовка для всех вызовов:

```http
Authorization: Bearer rc_xxxxxxxx
```

---

## Admin list shape (для UI / мониторинга)

`GET /api/admin/computers` (session admin):

```json
{
  "computers": [
    {
      "id": "uuid",
      "name": "render-box-1",
      "description": "",
      "status": "busy",
      "online": true,
      "currentProjectId": "uuid",
      "currentProjectName": "Client / Spot",
      "currentTask": "export-preview",
      "lastHeartbeatAt": "2026-08-10T12:00:30.000Z",
      "meta": {},
      "createdBy": "admin-user-uuid",
      "createdAt": "2026-08-10T10:00:00.000Z"
    }
  ]
}
```

Поле `online` вычисляется на сервере по правилу 90 секунд.
