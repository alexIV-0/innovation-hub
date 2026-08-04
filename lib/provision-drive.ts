import {
  ensureUserEmailFolder,
  formatDriveError,
  GoogleDriveConfigError,
  GoogleDriveError,
  isGoogleDriveConfigured,
} from "@/lib/google-drive"
import { findUserById, setUserDriveFolderId } from "@/lib/repositories/users"

/** In-process lock: concurrent provision for the same user shares one attempt. */
const provisionLocks = new Map<string, Promise<string | null>>()

/**
 * Ensures the user has a Google Drive root folder named by their email.
 * Idempotent: reuses an existing `drive_folder_id`, or finds/creates the
 * folder under GOOGLE_DRIVE_ROOT_FOLDER_ID. Never creates a second sibling
 * with the same email name (Drive find-or-create consolidates duplicates).
 *
 * Returns null when Drive is not configured (dev without credentials).
 */
export async function provisionUserDriveFolder(
  userId: string,
): Promise<string | null> {
  if (!isGoogleDriveConfigured()) {
    return null
  }

  const inFlight = provisionLocks.get(userId)
  if (inFlight) return inFlight

  const run = (async (): Promise<string | null> => {
    const user = await findUserById(userId)
    if (!user) return null
    if (user.driveFolderId) return user.driveFolderId

    try {
      const folderId = await ensureUserEmailFolder(user.email)
      // Re-read: another request may have written drive_folder_id first.
      const fresh = await findUserById(userId)
      if (fresh?.driveFolderId) return fresh.driveFolderId
      await setUserDriveFolderId(user.id, folderId)
      return folderId
    } catch (error) {
      console.error("[google-drive] provision user folder failed", {
        userId,
        email: user.email,
        message: formatDriveError(error),
        ...(error instanceof GoogleDriveConfigError ||
        error instanceof GoogleDriveError
          ? {}
          : { error }),
      })
      return null
    }
  })().finally(() => {
    if (provisionLocks.get(userId) === run) {
      provisionLocks.delete(userId)
    }
  })

  provisionLocks.set(userId, run)
  return run
}

/**
 * Fire-and-forget provision used from signup / OAuth / admin create.
 * Never throws — account creation must succeed even if Drive is down.
 */
export function provisionUserDriveFolderBackground(userId: string): void {
  void provisionUserDriveFolder(userId).catch((error) => {
    console.error("[google-drive] background provision failed", error)
  })
}
