# Storage sync contract (R2 + Postgres)

R2 is the source of truth for object bytes. Postgres (`project_files` + `storage_changes`) is a derived cache and change journal. The website and the processing app are clients of the same HTTP API.

**Full request/response reference:** [STORAGE_API.md](./STORAGE_API.md).

## Auth

- **Web UI:** session cookie (`inhub_session`), same as other account APIs.
- **Processing app (per-user):** `Authorization: Bearer mch_…` machine token.
- **Remote computer (fleet):** `POST /api/v1` with `{ action, props, token: "rc_…" }` — see [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md).

Create a user machine token (session required):

```http
POST /api/account/machine-tokens
Content-Type: application/json

{ "name": "render-box-1", "projectId": null }
```

Response includes `token` **once**. Optional `projectId` scopes the token to one project.

Revoke: `DELETE /api/account/machine-tokens` with `{ "id": "…" }`.

## Endpoints (`/api/storage/v1`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects` | Clients + projects catalog (machine-token friendly) |
| `GET` | `/capabilities` | Feature flags (`rename`, `copy`, `multipart`, …) |
| `GET` | `/tree?projectId=&prefix=` | Bootstrap tree from Postgres + current `cursor` |
| `GET` | `/delta?projectId=&since=` | Changes after cursor: `{ changes, cursor, truncated }` |
| `POST` | `/presign` | Signed PUT/GET URL (bytes go direct to R2) |
| `POST` | `/notify` | After PUT: HEAD object, upsert cache, append journal |
| `POST` | `/mkdir` | Create folder row + journal |
| `POST` | `/rename` | Rename/move file or folder (no R2 key change) |
| `DELETE` | `/object` | Delete file/folder (+ R2) + journal |
| `POST` | `/reindex?projectId=` | Full LIST vs cache; synthetic changes |
| `GET`/`PUT` | `/sidecars` | `folderState.json` / `options.json` |

### Change record

```json
{
  "seq": 1842,
  "op": "put",
  "key": "projects/{userId}/{projectId}/IN/uuid-name.mov",
  "projectId": "...",
  "etag": "...",
  "size": 123,
  "contentHash": null,
  "eventTime": 1722930000,
  "payload": {
    "fileId": "...",
    "name": "uuid-name.mov",
    "folderPath": "IN",
    "isFolder": false
  }
}
```

### Cursor rules

- `seq` is monotonic (`BIGSERIAL`); journal is append-only.
- If `truncated: true`, discard local index and call `/tree`.
- Retention window ≈ 90 days (by `event_time`).

### Upload flow (app)

1. `POST /presign` `{ projectId, method: "PUT", folderPath, fileName, contentType }`
2. HTTP PUT body to `url` (R2)
3. `POST /notify` `{ projectId, s3Key, folderPath, fileName, sizeBytes, contentType, originMtime?, contentHash? }`

### Sync loop (app / web)

1. `GET /tree` → apply entries, store `cursor`
2. Poll `GET /delta?since=<cursor>` every few seconds while project is open
3. Apply `put`/`delete`; advance `cursor`

Legacy cabinet routes under `/api/projects/[id]/drive/*` remain as thin wrappers. Fleet agents should use `POST /api/v1`. Per-user apps may keep `/api/storage/v1`.

## Key layout

```
projects/{userId}/{projectId}/project-meta.json
projects/{userId}/{projectId}/options/folderState.json
projects/{userId}/{projectId}/options/options.json
projects/{userId}/{projectId}/{folderPath}/{uuid}-{name}
```

## Migration

Apply:

```text
db/migrations/2026-08-06-storage-sync-contract.sql
db/migrations/2026-08-07-storage-clients.sql
```

Google Drive is not used at runtime. Migration scripts under `scripts/migrate-drive-to-r2.mjs` remain for one-time historical copy only.

To copy legacy Timeweb objects into the current R2 layout, first run:

```text
npm run storage:migrate-to-r2
```

Then review the dry-run output and execute `npm run storage:migrate-to-r2 -- --apply`.
The script copies and verifies objects before updating DB keys; it never deletes
the Timeweb source.
