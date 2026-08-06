/**
 * @deprecated Runtime cabinet uses R2 via `lib/project-storage.ts`.
 * This module remains only as a reference for the old Drive SSOT behaviour.
 * Do not import from app/ or components/.
 *
 * One-time data copy: `node scripts/migrate-drive-to-r2.mjs`
 */

export { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"

export {
  extractExposedOptions,
  siteUpdatedBy,
  type ExposedOption,
  type ExposedOptionValue,
  type ProjectFolderState,
  type ProjectStorageFile as ProjectDriveFile,
  type ProjectStorageState as ProjectDriveState,
  loadProjectStorageState as loadProjectDriveState,
  setProjectAutomationEnabled,
  updateProjectExposedOptions,
  ProjectStorageError as ProjectDriveStateError,
} from "@/lib/project-storage"

import { listProjectsByUserId } from "@/lib/repositories/projects"
import type { ProjectRecord } from "@/lib/domain-types"

/** Postgres is the source of truth for which projects exist. */
export async function listUserProjects(_input: {
  userId: string
  userDriveFolderId: string | null
}): Promise<ProjectRecord[]> {
  return listProjectsByUserId(_input.userId)
}
