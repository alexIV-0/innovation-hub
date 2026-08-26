/**
 * Разбор запроса и построение плана архива — общая часть двух роутов.
 *
 * `GET /archive/plan` и `GET /archive` принимают одни и те же параметры и
 * обязаны строить один и тот же план: расхождение здесь означало бы, что
 * пользователь видит одну нумерацию частей, а скачивает другую.
 */

import { NextResponse, type NextRequest } from "next/server"
import { findProjectById } from "@/lib/repositories/projects"
import {
  ArchiveError,
  buildArchivePlan,
  clampPartSize,
  resolveArchiveRoot,
  type ArchivePlan,
} from "@/lib/storage/archive"
import {
  requireProjectAccess,
  requireStorageApi,
  type StorageProjectAccess,
} from "@/lib/storage/auth"

export type ArchiveRequestParams = {
  projectId: string
  folderId: string | null
  folderPath: string | null
  partSize: number
}

export function parseArchiveParams(
  request: NextRequest,
): ArchiveRequestParams | null {
  const params = request.nextUrl.searchParams
  const projectId = params.get("projectId")?.trim()
  if (!projectId) return null

  const rawPartSize = params.get("partSize")
  return {
    projectId,
    folderId: params.get("folderId")?.trim() || null,
    folderPath: params.get("folderPath"),
    partSize: clampPartSize(
      rawPartSize ? Number.parseInt(rawPartSize, 10) : undefined,
    ),
  }
}

/**
 * Авторизация плюс план. Читателю расшаренного проекта архив доступен — он для
 * этого и приглашён: скачать по одному файлу ему уже можно.
 */
export async function resolveArchiveRequest(
  request: NextRequest,
): Promise<
  | NextResponse
  | { access: StorageProjectAccess; params: ArchiveRequestParams; plan: ArchivePlan }
> {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const params = parseArchiveParams(request)
  if (!params) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const access = await requireProjectAccess(auth, params.projectId)
  if (access instanceof NextResponse) return access

  const project = await findProjectById(params.projectId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  try {
    const root = await resolveArchiveRoot({
      projectId: params.projectId,
      projectName: project.name,
      folderId: params.folderId,
      folderPath: params.folderPath,
    })
    const plan = await buildArchivePlan({
      projectId: params.projectId,
      rootFolderPath: root.rootFolderPath,
      baseName: root.baseName,
      partSize: params.partSize,
    })
    return { access, params, plan }
  } catch (error) {
    if (error instanceof ArchiveError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    throw error
  }
}
