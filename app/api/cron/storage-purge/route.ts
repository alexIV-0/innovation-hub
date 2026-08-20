import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { purgeDeletedProjects } from "@/lib/storage/project-trash"
import { purgeExpiredTrash } from "@/lib/storage/trash"
import { exportMonthlyStats } from "@/lib/statistics/export-archive"
import { importProcessingArchive } from "@/lib/statistics/import-archive"
import { takeStorageSnapshot } from "@/lib/statistics/snapshots"

export const runtime = "nodejs"

async function runPurge() {
  const files = await purgeExpiredTrash()
  const projects = await purgeDeletedProjects()
  // Снимок состояний висит на этом же суточном тике (STATISTICS_PLAN §7.1):
  // он идемпотентен за день, поэтому лишний вызов ничего не испортит, а
  // пропущенный день восстановить будет уже нечем.
  const snapshot = await takeStorageSnapshot().catch((error) => {
    console.error("[stats] snapshot failed", error)
    return { projects: 0 }
  })
  const imported = await importProcessingArchive().catch((error) => {
    console.error("[stats] archive import failed", error)
    return null
  })
  const exported = await exportMonthlyStats().catch((error) => {
    console.error("[stats] monthly export failed", error)
    return null
  })
  return {
    ...files,
    projectsPurged: projects.purged,
    snapshotProjects: snapshot.projects,
    archiveRows: imported?.rowsInserted ?? 0,
    exportFiles: exported?.filesWritten ?? 0,
  }
}

/** POST /api/cron/storage-purge — drop trash older than 30 days. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  const bearer = request.headers.get("authorization")
  if (secret && bearer === `Bearer ${secret}`) {
    const result = await runPurge()
    return NextResponse.json({ ok: true, ...result })
  }

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  const result = await runPurge()
  return NextResponse.json({ ok: true, ...result })
}
