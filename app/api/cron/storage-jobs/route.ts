import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { processQueuedJobs } from "@/lib/storage/job-runner"
import { purgeDeletedProjects } from "@/lib/storage/project-trash"
import { purgeExpiredTrash } from "@/lib/storage/trash"

export const runtime = "nodejs"

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET?.trim()
  const bearer = request.headers.get("authorization")
  if (secret && bearer === `Bearer ${secret}`) return null

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }
  return null
}

/** POST /api/cron/storage-jobs — drain queued jobs and purge expired trash. */
export async function POST(request: NextRequest) {
  const denied = await authorize(request)
  if (denied) return denied

  const result = await processQueuedJobs(20)
  const files = await purgeExpiredTrash()
  const projects = await purgeDeletedProjects()

  return NextResponse.json({
    ok: true,
    ...result,
    filesPurged: files.purged,
    projectsPurged: projects.purged,
  })
}
