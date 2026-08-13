export type StorageChangeOp = "put" | "delete" | "move"

export type StoragePathRef = {
  folderPath: string
  name: string
}

export type StorageChangeRecord = {
  seq: number
  projectId: string
  key: string
  op: StorageChangeOp
  size: number | null
  etag: string | null
  contentHash: string | null
  eventTime: number
  eventId: string | null
  payload: StorageChangePayload
}

export type StorageChangePayload = {
  name?: string
  folderPath?: string
  isFolder?: boolean
  fileId?: string
  contentType?: string
  from?: StoragePathRef
  to?: StoragePathRef
}

export type StorageDeltaResponse = {
  changes: StorageChangeRecord[]
  cursor: number
  truncated: boolean
}

export type StorageTreeEntry = {
  id: string
  projectId: string
  folderPath: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number
  contentType: string
  etag: string | null
  contentHash: string | null
  originMtime: number | null
  createdAt: string
  updatedAt: string
  lastSeq: number | null
  displayPath?: string
}
