import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import { getJob, serializeJob } from "@/lib/storage/jobs"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** GET /api/storage/v1/jobs/:id */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ message: "Job not found." }, { status: 404 })
  }
  if (auth.role !== "ADMIN" && job.userId !== auth.userId) {
    return NextResponse.json({ message: "Job not found." }, { status: 404 })
  }
  return NextResponse.json({ job: serializeJob(job) })
}
