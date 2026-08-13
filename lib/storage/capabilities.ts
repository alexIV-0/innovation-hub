export const STORAGE_CAPABILITIES = {
  apiVersion: 1,
  protocol: 2,
  multipart: true,
  rename: true,
  move: true,
  copy: true,
  sharing: true,
  clients: true,
  originMtime: true,
  contentHash: true,
  trash: true,
} as const
