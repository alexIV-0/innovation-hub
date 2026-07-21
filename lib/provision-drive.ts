import {
  ensureUserEmailFolder,
  GoogleDriveConfigError,
  GoogleDriveError,
  isGoogleDriveConfigured,
} from "@/lib/google-drive"
import { findUserById, setUserDriveFolderId } from "@/lib/repositories/users"

/**
 * Ensures the user has a Google Drive root folder named by their email.
 * Idempotent: reuses an existing `drive_folder_id`, or finds/creates the
 * folder under GOOGLE_DRIVE_ROOT_FOLDER_ID.
 *
 * Returns null when Drive is not configured (dev without credentials).
 */
export async function provisionUserDriveFolder(
  userId: string,
): Promise<string | null> {
  if (!isGoogleDriveConfigured()) {
    return null
  }

  const user = await findUserById(userId)
  if (!user) return null
  if (user.driveFolderId) return user.driveFolderId

  try {
    const folderId = await ensureUserEmailFolder(user.email)
    await setUserDriveFolderId(user.id, folderId)
    return folderId
  } catch (error) {
    if (
      error instanceof GoogleDriveConfigError ||
      error instanceof GoogleDriveError
    ) {
      console.error("[google-drive] provision user folder failed", {
        userId,
        email: user.email,
        message: error.message,
      })
    } else {
      console.error("[google-drive] provision user folder failed", error)
    }
    return null
  }
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
