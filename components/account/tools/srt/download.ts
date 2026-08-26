"use client"

/**
 * Отдать файл в браузер.
 *
 * Один способ на все выгрузки: и текст, и архив уходят одинаково — временная
 * ссылка на blob, клик, освобождение. Освобождать обязательно: без `revokeObjectURL`
 * каждый экспорт оставляет содержимое файла в памяти вкладки до перезагрузки, а
 * за смену человек экспортирует десятки раз.
 */
export function downloadFile(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const ZIP_MIME = "application/zip"
