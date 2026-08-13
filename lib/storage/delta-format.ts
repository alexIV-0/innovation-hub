import type { StorageChangeRecord } from "@/lib/storage/types"
import {
  buildDisplayPath,
  type DisplayContext,
} from "@/lib/storage/display-path"

export function serializeStorageChange(
  change: StorageChangeRecord,
  display?: DisplayContext | null,
) {
  const to = change.payload.to
  const name = to?.name ?? change.payload.name ?? null
  const folderPath = to?.folderPath ?? change.payload.folderPath ?? null
  return {
    seq: change.seq,
    op: change.op,
    key: change.key,
    projectId: change.projectId,
    name,
    folderPath,
    isFolder: change.payload.isFolder ?? false,
    from: change.payload.from ?? null,
    to: change.payload.to ?? null,
    size: change.size,
    etag: change.etag,
    contentHash: change.contentHash,
    eventTime: change.eventTime,
    fileId: change.payload.fileId ?? null,
    contentType: change.payload.contentType ?? null,
    displayPath:
      display && name
        ? buildDisplayPath(display, folderPath ?? "", name)
        : null,
  }
}
