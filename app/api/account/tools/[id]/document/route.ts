import { createHash } from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { requireProjectAccess } from "@/lib/project-access"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { findUserTool } from "@/lib/repositories/user-tools"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { StorageWriteError, writeNotifyUpload } from "@/lib/storage/write-path"
import { parseDialogDoc, type DialogDoc } from "@/lib/tools/srt/dialog-doc"
import { mergeDialogDocs } from "@/lib/tools/srt/merge"
import { serializeDialogDoc, stampForSave } from "@/lib/tools/srt/serialize"

export const runtime = "nodejs"

/** Имя документа в папке задачи — фиксировано контрактом OUT_CONTRACT.md §1. */
const DOC_NAME = "dialog.json"
const PRODUCER = "innovation-hub/srt-editor 0.1"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  /** Документ целиком, как он выглядит в редакторе. */
  doc: z.unknown(),
  /**
   * Ревизия, от которой правили. Если в папке лежит другая — значит документ
   * тронули со стороны, и запись идёт через слияние, а не поверх.
   */
  baseRevision: z.number().int().nonnegative(),
})

/**
 * Сохранение документа задачи.
 *
 * Читает-сливает-пишет на сервере, а не тремя запросами из браузера, и по одной
 * причине: между чтением и записью не должно быть окна, в которое влезет вторая
 * вкладка. Тот же путь записи, что у остальных файлов проекта (`writeNotifyUpload`),
 * поэтому журнал изменений и курсор синхронизации остаются верными.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const tool = await findUserTool(id, auth.userId)
  if (!tool) return NextResponse.json({ message: "Tool not found." }, { status: 404 })

  const source = (tool.source ?? {}) as { projectId?: string | null; folderPath?: string | null }
  const projectId = source.projectId ?? null
  const folderPath = source.folderPath ?? null
  if (!projectId || !folderPath) {
    return NextResponse.json({ message: "Tool has no source folder." }, { status: 400 })
  }

  const access = await requireProjectAccess(projectId, auth.userId, "editor")
  if (access instanceof NextResponse) return access
  if (!isS3Configured()) {
    return NextResponse.json({ message: "Object storage is not available." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsedBody = schema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      { message: parsedBody.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const incoming = parseDialogDoc(parsedBody.data.doc)
  if (!incoming.ok) {
    // Испорченный документ до хранилища не доходит: перезапись битым файлом
    // хуже потери несохранённых правок.
    return NextResponse.json(
      { message: "Document is invalid.", error: incoming.error },
      { status: 422 },
    )
  }

  const files = await listFilesInFolder(projectId, folderPath)
  const row = files.find((file) => !file.isFolder && file.name === DOC_NAME)
  if (!row?.s3Key) {
    return NextResponse.json({ message: "dialog.json not found." }, { status: 404 })
  }

  const client = getS3Client()
  const bucket = getS3Bucket()

  /**
   * Читаем-сливаем-пишем условной записью, до трёх попыток (§8 контракта).
   *
   * `If-Match` по ETag закрывает окно между чтением и записью: без него две
   * вкладки, нажавшие «сохранить» одновременно, обе прочитают одну версию и
   * вторая молча затрёт первую. Хранилище на несовпадение отвечает `412`, и
   * попытка начинается заново — уже от актуальной версии.
   */
  let response: {
    revision: number
    updatedAt: string
    merged: boolean
    taken: number
    conflicts: number
    doc?: DialogDoc
  } | null = null

  for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
    let stored: unknown = null
    let etag: string | undefined
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: row.s3Key }))
      etag = object.ETag
      const text = await object.Body?.transformToString("utf-8")
      stored = text ? JSON.parse(text) : null
    } catch (error) {
      console.error("[srt-editor] read before save failed", error)
      return NextResponse.json({ message: "Failed to read the document." }, { status: 503 })
    }

    const current = parseDialogDoc(stored)
    let merged = false
    let taken = 0
    let conflicts = 0
    let next = incoming.doc
    let baseRevision = parsedBody.data.baseRevision

    if (current.ok) {
      baseRevision = current.doc.revision
      if (current.doc.revision !== parsedBody.data.baseRevision) {
        const report = mergeDialogDocs(incoming.doc, current.doc)
        next = report.doc
        merged = true
        taken = report.taken
        conflicts = report.conflicts
      }
    }

    const at = new Date().toISOString()
    const revision = merged ? next.revision : baseRevision + 1
    const document = stampForSave(next, {
      revision,
      updatedBy: auth.email,
      producer: PRODUCER,
      at,
    })
    const bytes = Buffer.from(serializeDialogDoc(document), "utf-8")

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: row.s3Key,
          Body: bytes,
          ContentType: "application/json",
          IfMatch: etag,
        }),
      )
    } catch (error) {
      if (isPreconditionFailed(error)) continue
      console.error("[srt-editor] write failed", error)
      return NextResponse.json({ message: "Failed to write the document." }, { status: 503 })
    }

    try {
      await writeNotifyUpload({
        userId: access.project.ownerId,
        projectId,
        s3Key: row.s3Key,
        folderPath,
        fileName: DOC_NAME,
        sizeBytes: bytes.byteLength,
        contentType: "application/json",
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        originMtime: Math.floor(Date.parse(at) / 1000),
        // Редактор не заливщик исходников: `contact` задачи из-за сохранения
        // документа переезжать не должен.
        actor: { userId: auth.userId, isUploader: false },
      })
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return NextResponse.json({ message: error.message }, { status: error.status })
      }
      // Байты уже в хранилище — падать здесь нельзя, но и молчать не о чем:
      // строка в базе догонит на следующем сохранении или переиндексации.
      console.error("[srt-editor] notify after save failed", error)
    }

    response = {
      revision,
      updatedAt: at,
      merged,
      taken,
      conflicts,
      // При слиянии возвращаем документ целиком: у клиента он теперь неверный.
      doc: merged ? document : undefined,
    }
  }

  if (!response) {
    // Трижды не смогли записать от актуальной версии — значит документ правят
    // прямо сейчас с другой стороны. Пусть клиент попробует ещё раз сам.
    return NextResponse.json({ message: "Document is being edited elsewhere." }, { status: 409 })
  }

  return NextResponse.json(response)
}

/**
 * Условная запись не прошла: версия в хранилище уже другая.
 *
 * Хранилище отвечает `PreconditionFailed`; имя ошибки у разных реализаций
 * S3-совместимого API отличается, поэтому смотрим и на код статуса.
 */
function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412
}
