"use client"

import { Eye } from "lucide-react"

import { cn } from "@/lib/utils"
import { fileIcon, fileIconClass, fmtDate, fmtSize } from "./format"
import { useWorkspace } from "./workspace-context"

/** Правая колонка полного режима: превью выбранного файла. */
export function PreviewPane({ className }: { className?: string }) {
  const { t, lang, selectedFile, selection, selectedId } = useWorkspace()

  if (!selectedFile || selectedFile.isFolder || !selectedId) {
    return (
      <aside
        className={cn(
          "hidden w-[264px] shrink-0 border-l border-white/[0.07] bg-ws-well p-[18px] xl:block",
          className,
        )}
      >
        <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2.5 text-center text-ws-5">
          <Eye className="h-[34px] w-[34px]" />
          <span className="text-[12.5px]">{t.previewEmpty}</span>
        </div>
      </aside>
    )
  }

  const file = selectedFile
  const Icon = fileIcon(file)
  const url = `/api/projects/${selectedId}/drive/files/${file.id}`
  const isImage = file.mimeType.startsWith("image/")
  const isVideo = file.mimeType.startsWith("video/")
  const isAudio = file.mimeType.startsWith("audio/")

  return (
    <aside
      className={cn(
        "hidden w-[264px] shrink-0 overflow-y-auto border-l border-white/[0.07] bg-ws-well p-[18px] xl:block",
        className,
      )}
    >
      {selection.length > 1 ? (
        <p className="mb-3 rounded-lg border border-ws-select/40 bg-ws-select/[0.12] px-3 py-1.5 text-center text-[12px] text-ws-1">
          {t.selectedCount}: {selection.length}
        </p>
      ) : null}
      <div className="flex flex-col items-center text-center">
        <div className="mb-3.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-[10px] border border-white/[0.08] bg-ws-control">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={file.name}
              className="h-full w-full object-contain"
            />
          ) : isVideo ? (
            <video src={url} controls className="h-full w-full" />
          ) : (
            <Icon className={cn("h-12 w-12", fileIconClass(file))} />
          )}
        </div>
        {isAudio ? (
          <audio src={url} controls className="mb-3 w-full" />
        ) : null}
        <p className="break-words text-[14px] text-ws-1">{file.name}</p>
        <p className="mt-1 text-[12px] text-ws-accent">{file.mimeType}</p>
      </div>

      <dl className="mt-[18px]">
        <div className="flex justify-between border-t border-white/[0.07] py-[9px] text-[12.5px]">
          <dt className="text-ws-4">{t.sizeLabel}</dt>
          <dd className="text-ws-2">{fmtSize(file.sizeBytes)}</dd>
        </div>
        <div className="flex justify-between border-t border-white/[0.07] py-[9px] text-[12.5px]">
          <dt className="text-ws-4">{t.dateLabel}</dt>
          <dd className="text-ws-2">
            {fmtDate(file.modifiedAt ?? file.createdAt, lang)}
          </dd>
        </div>
      </dl>
    </aside>
  )
}
