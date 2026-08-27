import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { exportMonthlyStats } from "@/lib/statistics/export-archive"
import { importProcessingArchive } from "@/lib/statistics/import-archive"
import { takeStorageSnapshot } from "@/lib/statistics/snapshots"

export const runtime = "nodejs"
/** Полный проход по архиву может занять минуты — короткий лимит его срежет. */
export const maxDuration = 300

/**
 * Ручной прогон приёмника: догнать архив, не дожидаясь часового тика
 * (docs/PIPELINE.md §14). Идемпотентен, поэтому кнопку можно жать сколько
 * угодно: строки дедуплицируются по `item_id`, снимок за сутки перезаписывается.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "statistics.import")
  if (auth instanceof NextResponse) return auth

  const snapshot = await takeStorageSnapshot().catch((error) => {
    console.error("[stats] manual snapshot failed", error)
    return { projects: 0 }
  })
  const imported = await importProcessingArchive()
  // Экспорт сразу за импортом: без него свежие строки живут только в базе, а
  // независимой от пользовательских папок копии у них ещё нет.
  const exported = await exportMonthlyStats()

  return NextResponse.json({
    ok: true,
    snapshotProjects: snapshot.projects,
    ...imported,
    exportFiles: exported.filesWritten,
    exportRows: exported.rowsWritten,
  })
}
