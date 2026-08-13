import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { countPipelineTasksByStatus, listPipelineTasks } from "@/lib/pipeline/tasks"

export const runtime = "nodejs"

/** Очередь задач: что нашлось, кто взял, в каком состоянии. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const [tasks, counts] = await Promise.all([
    listPipelineTasks(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ tasks, counts })
}
