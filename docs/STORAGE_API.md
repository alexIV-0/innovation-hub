# Storage API reference

Base path: `/api/storage/v1`  
Auth tokens: `/api/account/machine-tokens` (user) · admin computers via [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md)

Architecture and sync rules: [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md).

---

## Authentication

All `/api/storage/v1/*` endpoints accept either:

| Client | How |
|---|---|
| Web UI | Session cookie `inhub_session` |
| Processing app (per-user) | `Authorization: Bearer mch_…` |
| Remote computer (fleet) | `Authorization: Bearer rc_…` |

Errors:

| Status | Meaning |
|---|---|
| `401` | Missing / invalid credentials |
| `403` | Inactive account, or machine token scoped to another project |
| `404` | Project not found / no access |

Admin role and remote computer tokens (`rc_…`) can access any project. Machine tokens with `projectId` set may only touch that project.

Remote computer presence / heartbeat: [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md).

---

## Common types

### `ProjectFile`

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "folderPath": "IN",
  "name": "clip.mov",
  "isFolder": false,
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "sizeBytes": 1234567,
  "contentType": "video/quicktime",
  "createdAt": "2026-08-06T10:00:00.000Z"
}
```

Folders have `isFolder: true`, `s3Key: null`, `sizeBytes: 0`.

### `TreeEntry`

Extends file metadata from the cache:

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "folderPath": "IN",
  "name": "clip.mov",
  "isFolder": false,
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "sizeBytes": 1234567,
  "contentType": "video/quicktime",
  "etag": "abc123",
  "contentHash": null,
  "originMtime": 1722930000,
  "createdAt": "2026-08-06T10:00:00.000Z",
  "updatedAt": "2026-08-06T10:00:00.000Z",
  "lastSeq": 1842
}
```

### `Change`

```json
{
  "seq": 1842,
  "op": "put",
  "key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "projectId": "uuid",
  "name": "clip.mov",
  "folderPath": "IN",
  "isFolder": false,
  "size": 1234567,
  "etag": "abc123",
  "contentHash": null,
  "eventTime": 1722930000,
  "fileId": "uuid",
  "contentType": "video/quicktime"
}
```

`op` is `"put"` or `"delete"`. `seq` is monotonic per journal (global `BIGSERIAL`).

### Error body

```json
{ "message": "Human-readable reason." }
```

---

## Machine tokens

Session cookie required (browser / logged-in user). Raw token is returned **once** on create.

### `GET /api/account/machine-tokens`

List non-revoked tokens for the current user.

**Response `200`**

```json
{
  "tokens": [
    {
      "id": "uuid",
      "name": "render-box-1",
      "projectId": null,
      "createdAt": "2026-08-06T10:00:00.000Z",
      "lastUsedAt": null
    }
  ]
}
```

### `POST /api/account/machine-tokens`

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 1–120 chars |
| `projectId` | string \| null | no | Scope to one project; omit/`null` = all owned projects |

**Response `201`**

```json
{
  "id": "uuid",
  "token": "mch_…",
  "name": "render-box-1",
  "projectId": null
}
```

Store `token` securely. It is not shown again.

### `DELETE /api/account/machine-tokens`

**Body:** `{ "id": "uuid" }`  
**Response `200`:** `{ "ok": true }`

---

## `GET /api/storage/v1/capabilities`

Feature flags for storage clients. Authenticated via session, machine token, or remote computer token.


**Response `200`**

```json
{
  "apiVersion": 1,
  "multipart": false,
  "rename": true,
  "copy": false,
  "sharing": false,
  "clients": true,
  "originMtime": true,
  "contentHash": true
}
```

---

## `GET /api/storage/v1/projects`

List clients and projects visible to the caller. Prefer this over `GET /api/projects` for machine tokens.

| Auth | Result |
|---|---|
| Machine token with `projectId` set | That project only (+ its client if any) |
| USER | Owned clients + projects |
| ADMIN | All clients + projects |

**Response `200`**

```json
{
  "clients": [{ "id": "uuid", "displayName": "Megafon" }],
  "projects": [
    {
      "id": "uuid",
      "name": "Ads Q3",
      "clientId": "uuid",
      "groupName": "personal",
      "isActive": true,
      "isPaused": false,
      "updatedAt": "2026-08-07T12:00:00.000Z"
    }
  ]
}
```

`clientId` may be `null`. Client grouping is a DB relation only — R2 keys use `projects/{userId}/{projectId}/…`.

---

## `GET /api/storage/v1/tree`

Bootstrap / full subtree from Postgres cache.

**Query**

| Param | Required | Notes |
|---|---|---|
| `projectId` | yes | |
| `prefix` | no | Logical folder path (`""` = whole project). Matches `folder_path = prefix` or descendants. |

**Response `200`**

```json
{
  "entries": [ /* TreeEntry[] */ ],
  "cursor": 1842
}
```

`cursor` is the latest `storage_changes.seq` for this project (or `0` if empty). Use it as `since` for `/delta`.

---

## `GET /api/storage/v1/delta`

Incremental changes after a cursor.

**Query**

| Param | Required | Notes |
|---|---|---|
| `projectId` | yes | |
| `since` | no | Default `0`. Integer ≥ 0. Returns rows with `seq > since`. |

**Response `200`**

```json
{
  "changes": [ /* Change[] */ ],
  "cursor": 1900,
  "truncated": false
}
```

| Field | Meaning |
|---|---|
| `changes` | Up to 5000 events, ordered by `seq` ascending |
| `cursor` | Advance local cursor to this value (even if `changes` is empty) |
| `truncated` | `true` if `since` is older than retained journal (~90 days) → discard local index and call `/tree` |

---

## `POST /api/storage/v1/presign`

Issue a short-lived signed URL. **Bytes go directly to/from R2**, not through the API.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | |
| `method` | `"PUT"` \| `"GET"` | yes | PUT needs owner access |
| `folderPath` | string | no | Default `""`. For PUT when generating a new key |
| `fileName` | string | for PUT | Sanitized server-side |
| `contentType` | string | for PUT | Must pass upload policy |
| `s3Key` | string | for GET; optional for PUT | Must be under project prefix |
| `ttlSec` | number | no | 60–86400, default `3600` |

**Response `200` (PUT)**

```json
{
  "url": "https://…",
  "method": "PUT",
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "fileName": "clip.mov",
  "folderPath": "IN",
  "contentType": "video/quicktime",
  "expiresIn": 3600
}
```

**Response `200` (GET)**

```json
{
  "url": "https://…",
  "method": "GET",
  "s3Key": "…",
  "expiresIn": 3600
}
```

After a successful PUT to `url`, call **`/notify`**.

---

## `POST /api/storage/v1/notify`

Confirm an object that was uploaded via presigned PUT. Server runs HEAD on R2, upserts `project_files`, appends `storage_changes`.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `s3Key` | string | yes |
| `fileName` | string | yes |
| `folderPath` | string | no (default `""`) |
| `sizeBytes` | number | no |
| `contentType` | string | no |
| `originMtime` | number | no (unix seconds; preferred over R2 `mtime` metadata) |
| `contentHash` | string | no (e.g. sha256 hex; preferred over R2 metadata) |
| `eventId` | string | no (idempotency / dedup) |

Body fields override matching R2 object metadata when present. Metadata fallbacks: `x-amz-meta-mtime` / `mtime`, `x-amz-meta-sha256` / `sha256`.

**Response `201`:** `{ "file": ProjectFile }`  
**`409`:** object missing in R2 / write conflict  
**`400`:** key outside project prefix

---

## `POST /api/storage/v1/rename`

Rename or move a file/folder in the catalog. Does **not** change `s3Key` (logical path only). Uses the same `writeRename` path as the cabinet UI.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `fileId` | string | yes |
| `name` | string | no (at least one of `name` / `folderPath`) |
| `folderPath` | string | no |
| `eventId` | string | no |

**Response `200`:** `{ "file": ProjectFile }`  
**`404`:** file not found  
**`409`:** name collision in target folder

---

## `POST /api/storage/v1/mkdir`

Create a folder row in the cache (+ journal). Does not require an R2 object (folders are logical).

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `name` | string | yes (1–180, no `/` or `\`) |
| `folderPath` | string | no (parent path, default `""`) |
| `eventId` | string | no |

Reserved name: `options` → `403`.

**Response `201`:** `{ "file": ProjectFile }`  
**`409`:** name already exists in that folder

---

## `DELETE /api/storage/v1/object`

Delete a file or folder (cascade children). Removes R2 objects for files and journals deletes.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `fileId` | string | yes |
| `eventId` | string | no |

**Response `200`**

```json
{
  "ok": true,
  "deletedS3Keys": ["projects/{userId}/{projectId}/…"]
}
```

`options` folder → `403`. Missing file → `404`.

---

## `POST /api/storage/v1/reindex`

Full `ListObjectsV2` of the project prefix vs Postgres. Inserts / updates / removes cache rows and writes synthetic journal events.

**Query or body:** `projectId` (required)

**Response `200`**

```json
{
  "ok": true,
  "scanned": 120,
  "inserted": 3,
  "updated": 1,
  "removed": 0
}
```

Skips `options/*` and `project-meta.json`. Max duration 120s. Owner (or admin) only.

---

## `GET /api/storage/v1/sidecars`

Read automation JSON from R2.

**Query**

| Param | Required | Values |
|---|---|---|
| `projectId` | yes | |
| `name` | yes | `folder-state` \| `options` |

**Response `200`:** `{ "key": "…", "body": "<raw json string>" }`  
**`404`:** object missing

---

## `PUT /api/storage/v1/sidecars`

Update sidecars. Discriminated by `kind`.

### `kind: "folder-state"`

Toggle automation (`folderState.json` + `projects.is_active` cache).

```json
{
  "kind": "folder-state",
  "projectId": "uuid",
  "enabled": true
}
```

**Response `200`:** `{ "folderState": { … } }`

### `kind: "options"`

Patch `exposedToSite` parameters in `options.json`.

```json
{
  "kind": "options",
  "projectId": "uuid",
  "changes": [
    { "path": ["plugins", "0", "enabled"], "value": true }
  ]
}
```

**Response `200`:** `{ "options": [ /* ExposedOption[] */ ] }`

### `kind: "raw"`

Replace entire sidecar body (optional conditional write).

```json
{
  "kind": "raw",
  "projectId": "uuid",
  "sidecar": "folder-state",
  "body": "{ … }",
  "ifMatch": "etag-optional"
}
```

**Response `200`:** `{ "ok": true, "etag": "…" }`  
**`409`:** precondition failed / business rule violation

---

## Client flows

### Sync loop (website / processing app)

```
1. GET /tree?projectId=…          → apply entries, store cursor
2. loop every few seconds:
     GET /delta?projectId=…&since={cursor}
     if truncated → goto 1
     apply changes; cursor = response.cursor
```

### Upload (processing app)

```
1. POST /presign  { projectId, method: "PUT", folderPath, fileName, contentType }
2. HTTP PUT bytes to response.url  (Content-Type must match)
3. POST /notify   { projectId, s3Key, folderPath, fileName, sizeBytes, contentType }
4. Other clients see the put via /delta
```

### Download

```
POST /presign { projectId, method: "GET", s3Key }
→ GET response.url
```

Or use existing media proxy / legacy download routes for browser session users.

---

## Object key layout

```
projects/{userId}/{projectId}/project-meta.json
projects/{userId}/{projectId}/options/folderState.json
projects/{userId}/{projectId}/options/options.json
projects/{userId}/{projectId}/{folderPath}/{uuid}-{safeName}
```

`userId` and `projectId` are stable UUIDs. Logical folders live in Postgres; only files (and sidecar JSON) are R2 objects.

---

## Legacy routes

Cabinet UI still calls `/api/projects/[id]/drive/*` and `/files/*`. Those mutate through the same write-path and journal. **New clients (desktop app) should use only `/api/storage/v1`.**

| Legacy | Prefer |
|---|---|
| `GET /api/projects/:id/drive` | `GET /tree` |
| `POST /api/projects/:id/drive` (mkdir) | `POST /mkdir` |
| `DELETE …/drive/files/:fileId` | `DELETE /object` |
| `POST …/files/presign` + confirm | `POST /presign` + `/notify` |

---

## HTTP status cheat sheet

| Code | Typical cause |
|---|---|
| `200` / `201` | Success |
| `400` | Bad JSON / missing params / invalid key |
| `401` | Not authenticated |
| `403` | Reserved name, scoped token, inactive user |
| `404` | Project or file not found |
| `409` | Conflict (duplicate name, missing R2 object, ETag) |
| `503` | Storage not configured / R2 / reindex failure |
| `500` | Unexpected server error |
