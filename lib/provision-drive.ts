/**
 * @deprecated Drive user-folder provisioning is no longer used.
 * Project files live on R2 (`lib/project-storage.ts`). Kept as a no-op so
 * any stale dynamic import does not crash.
 */

export async function provisionUserDriveFolder(
  _userId: string,
): Promise<string | null> {
  return null
}

export function provisionUserDriveFolderBackground(_userId: string): void {
  // no-op
}
