import { GetObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { layoutForPart } from "@/lib/storage/archive"
import { resolveArchiveRequest } from "@/lib/storage/archive-request"
import { createZipStream } from "@/lib/storage/zip-stream"

export const runtime = "nodejs"

/**
 * `filename` для нелатинского имени: ASCII-вариант для старых клиентов и
 * `filename*` по RFC 5987 для всех остальных.
 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\u0020-\u007e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * GET /api/storage/v1/archive — одна часть архива папки потоком.
 *
 * Байты идут через приложение, а не напрямую из R2: архива в бакете не
 * существует, он собирается на ходу из объектов папки. Память при этом не
 * растёт — поток тянется скоростью клиента (см. lib/storage/zip-stream.ts).
 *
 * Параметры повторяют `/archive/plan`, плюс:
 *   `part`    — номер части из плана, с единицы;
 *   `version` — отпечаток плана. Не совпал — папка изменилась после того, как
 *               человек посмотрел на список частей, и нумерация уже другая:
 *               409, а не архив с неожиданным содержимым.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveArchiveRequest(request)
  if (resolved instanceof NextResponse) return resolved

  const { plan, params } = resolved
  const search = request.nextUrl.searchParams
  const version = search.get("version")
  const partIndex = Number.parseInt(search.get("part") ?? "1", 10)

  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not configured." },
      { status: 503 },
    )
  }
  if (plan.parts.length === 0) {
    return NextResponse.json({ message: "Folder is empty." }, { status: 409 })
  }
  if (version && version !== plan.version) {
    return NextResponse.json(
      {
        message: "Folder changed — reload the archive list.",
        version: plan.version,
      },
      { status: 409 },
    )
  }
  const part = plan.parts.find((candidate) => candidate.index === partIndex)
  if (!part) {
    return NextResponse.json({ message: "Part not found." }, { status: 404 })
  }

  const layout = layoutForPart(part)
  const client = getS3Client()
  const bucket = getS3Bucket()

  const stream = createZipStream({
    layout,
    openObject: async (s3Key) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
      )
      if (!response.Body) throw new Error(`Empty object: ${s3Key}`)
      return response.Body.transformToWebStream() as ReadableStream<Uint8Array>
    },
    onSizeMismatch: (entry, outcome) => {
      // Каталог разошёлся с бакетом. Часть отдаётся до конца — обещанный
      // Content-Length менять уже нельзя, — но запись в архиве битая.
      console.error(
        `[archive] size mismatch ${entry.s3Key}: catalog ${entry.size}, read ${outcome.written}`,
        outcome,
      )
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(layout.totalSize),
      "Content-Disposition": contentDisposition(part.name),
      "Cache-Control": "private, no-store",
      // Докачки нет: CRC записи считается на ходу, отдать середину архива
      // без пересчёта всего предыдущего нельзя.
      "Accept-Ranges": "none",
      // nginx иначе положит двухгигабайтный ответ в буфер на диске, прежде чем
      // отдать клиенту первый байт (proxy_buffering включён по умолчанию).
      "X-Accel-Buffering": "no",
      "X-Archive-Part": `${part.index}/${plan.parts.length}`,
      "X-Archive-Version": plan.version,
      "X-Archive-Project": params.projectId,
    },
  })
}
