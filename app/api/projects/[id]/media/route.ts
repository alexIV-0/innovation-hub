import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { withoutServiceRows } from "@/lib/project-storage"
import { listAllProjectFiles } from "@/lib/repositories/project-files"
import { findProjectForUser } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return jsonError("Project not found.", 404)
  }

  // Служебные файлы из options — не материалы проекта: у сайдкаров появились
  // строки в каталоге, и без фильтра options.json и статистика обработки
  // оказались бы в списке наравне с файлами пользователя.
  const files = withoutServiceRows(await listAllProjectFiles(project.id)).filter(
    (f) => !f.isFolder,
  )
  return NextResponse.json({
    media: files.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      fileName: f.name,
      mimeType: f.contentType,
      sizeBytes: f.sizeBytes,
      driveFileId: null,
      s3Key: f.s3Key,
      createdAt: f.createdAt,
    })),
  })
}

/** Bytes go to R2 via presigned PUT. See POST /api/storage/v1/presign + /notify. */
export async function POST() {
  return jsonError(
    "Upload through the server is disabled. Use POST /api/storage/v1/presign then PUT to the returned URL, then POST /api/storage/v1/notify.",
    410,
  )
}
