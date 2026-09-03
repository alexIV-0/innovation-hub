import { resolveProjectContentType } from "@/lib/project-upload-policy"

export type DirectUploadResult = {
  id: string
  projectId: string
  name: string
  contentType: string
  sizeBytes: number
  s3Key: string | null
  createdAt: string
}

/**
 * Browser upload: presign → PUT bytes to R2 → notify. Does not go through Next.
 */
export async function uploadProjectFileDirect(input: {
  projectId: string
  file: File
  folderPath?: string
  /**
   * Под каким именем сохранить. Пусто — имя самого файла.
   *
   * Нужно, когда имя в папке занято и человек выбрал «сохранить оба»: файл на
   * диске у него тот же, а в проекте должен лечь как `clip (2).mp4`.
   */
  name?: string
  /**
   * Писать поверх одноимённого файла: тот же объект, та же строка каталога, тот
   * же `file_id`. Ключ находит сервер — браузеру физическая идентичность
   * объекта не нужна.
   */
  overwrite?: boolean
  onProgress?: (percent: number) => void
}): Promise<DirectUploadResult> {
  const name = input.name ?? input.file.name
  const contentType =
    resolveProjectContentType({ name, type: input.file.type }) ??
    "application/octet-stream"
  const folderPath = input.folderPath ?? ""

  const presignRes = await fetch("/api/storage/v1/presign", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      method: "PUT",
      folderPath,
      fileName: name,
      contentType,
      overwrite: input.overwrite ?? false,
    }),
  })
  const presign = (await presignRes.json().catch(() => null)) as
    | {
        url?: string
        s3Key?: string
        fileName?: string
        folderPath?: string
        contentType?: string
        message?: string
      }
    | null
  if (!presignRes.ok || !presign?.url || !presign.s3Key) {
    throw new Error(presign?.message ?? `Could not prepare upload (${presignRes.status})`)
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", presign.url!)
    xhr.setRequestHeader("Content-Type", presign.contentType ?? contentType)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && input.onProgress) {
        input.onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error("Network error during upload."))
    xhr.send(input.file)
  })

  const notifyRes = await fetch("/api/storage/v1/notify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      s3Key: presign.s3Key,
      folderPath: presign.folderPath ?? folderPath,
      fileName: name,
      sizeBytes: input.file.size,
      contentType: presign.contentType ?? contentType,
    }),
  })
  const notify = (await notifyRes.json().catch(() => null)) as
    | { file?: DirectUploadResult & { name: string }; message?: string }
    | null
  if (!notifyRes.ok || !notify?.file) {
    throw new Error(notify?.message ?? `Upload confirm failed (${notifyRes.status})`)
  }
  const file = notify.file
  return {
    ...file,
    createdAt: new Date(file.createdAt).toISOString(),
  }
}
