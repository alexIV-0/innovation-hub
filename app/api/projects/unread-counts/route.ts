import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { listProjectsByUserId } from "@/lib/repositories/projects"

export const runtime = "nodejs"

/**
 * Unread chat message counts for all of the caller's projects, keyed by
 * project id. Polled client-side (see ProjectsSection/DashboardSection) to
 * keep badges fresh without a full page reload.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const projects = await listProjectsByUserId(auth.userId)
  const counts = await countUnreadForProjects(projects.map((p) => p.id))
  return NextResponse.json({ counts })
}
