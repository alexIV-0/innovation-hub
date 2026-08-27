import { GetObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { findFileById } from "@/lib/repositories/project-files"
import { findProjectById } from "@/lib/repositories/projects"
import { getS3Bucket, projectObjectPrefix } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>
}

/**
 * Отдаёт содержимое файла проекта для колонки 3 и панели превью.
 *
 * Только чтение: писать в чужой проект из «Конвейера» нельзя.
 *
 * fileId бывает двух видов, и это следствие того, что служебных файлов нет в
 * project_files (см. listProjectServiceFiles):
 *
 *   — uuid строки project_files — обычный файл пользователя;
 *   — сам ключ в объектном хранилище — файл из папки options.
 *
 * Второй случай означает, что идентификатор приходит от клиента, поэтому ключ
 * проверяется на принадлежность именно этому проекту и именно папке options.
 * Без проверки это был бы чтение любого объекта бакета по произвольному пути.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available." },
      { status: 503 },
    )
  }

  const decodedId = decodeURIComponent(fileId)
  const optionsPrefix = `${projectObjectPrefix(project.ownerId, project.id)}options/`

  let key: string
  let name: string
  let contentType: string

  if (decodedId.startsWith("projects/")) {
    if (!decodedId.startsWith(optionsPrefix) || decodedId.includes("..")) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    key = decodedId
    name = decodedId.slice(decodedId.lastIndexOf("/") + 1)
    contentType = name.endsWith(".json")
      ? "application/json; charset=utf-8"
      : name.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : "application/octet-stream"
  } else {
    const file = await findFileById(decodedId)
    if (!file || file.projectId !== project.id) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (file.isFolder || !file.s3Key) {
      return NextResponse.json(
        { message: "Folders cannot be downloaded." },
        { status: 400 },
      )
    }
    key = file.s3Key
    name = file.name
    contentType = file.contentType || "application/octet-stream"
  }

  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const body = response.Body
    if (!body) {
      return NextResponse.json({ message: "Empty object." }, { status: 404 })
    }
    const bytes = await body.transformToByteArray()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": contentType || response.ContentType || "application/octet-stream",
        // inline, а не attachment: панель превью показывает файл на месте,
        // а не скачивает его при каждом выборе в списке.
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[pipeline] file read failed", error)
    return NextResponse.json(
      { message: "Failed to read file." },
      { status: 503 },
    )
  }
}
