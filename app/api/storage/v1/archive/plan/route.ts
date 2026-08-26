import { NextResponse, type NextRequest } from "next/server"
import {
  MAX_PART_BYTES,
  MIN_PART_BYTES,
  serializeArchivePlan,
} from "@/lib/storage/archive"
import { resolveArchiveRequest } from "@/lib/storage/archive-request"

export const runtime = "nodejs"

/**
 * GET /api/storage/v1/archive/plan — состав архивов папки, без скачивания.
 *
 * Отдельный запрос перед скачиванием нужен, чтобы человек увидел, во что он
 * ввязывается: сколько частей, какого размера и сколько файлов. Ответ ничего не
 * занимает на сервере — план выводится из каталога и опознаётся по `version`.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveArchiveRequest(request)
  if (resolved instanceof NextResponse) return resolved

  return NextResponse.json(
    {
      plan: serializeArchivePlan(resolved.plan),
      limits: { minPartSize: MIN_PART_BYTES, maxPartSize: MAX_PART_BYTES },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
