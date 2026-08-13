export const STORAGE_CAPABILITIES = {
  apiVersion: 1,
  protocol: 2,
  multipart: false,
  rename: true,
  move: true,
  copy: false,
  sharing: false,
  clients: true,
  originMtime: true,
  contentHash: true,
  trash: true,
} as const
