import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { statsQuerySchema } from "@/lib/project-schemas"
import { findUserById } from "@/lib/repositories/users"
import {
  getOwnerFileStats,
  getUploadChart,
} from "@/lib/repositories/project-files"
import {
  countProjectsByOwner,
  findOwnedProject,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const raw = {
    range: request.nextUrl.searchParams.get("range") ?? "week",
    projectId: request.nextUrl.searchParams.get("projectId") || null,
  }
  const parsed = statsQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid query." }, { status: 400 })
  }

  if (parsed.data.projectId) {
    const owned = await findOwnedProject(parsed.data.projectId, auth.userId)
    if (!owned) {
      return NextResponse.json(
        { message: "Project not found." },
        { status: 404 },
      )
    }
  }

  const user = await findUserById(auth.userId)
  const projectCount = await countProjectsByOwner(auth.userId)
  const fileStats = await getOwnerFileStats(auth.userId)
  const chartBars = await getUploadChart(
    auth.userId,
    parsed.data.range,
    parsed.data.projectId,
  )

  const periodClips = chartBars.reduce((s, b) => s + b.value, 0)

  return NextResponse.json({
    balanceCents: user?.balanceCents ?? 0,
    projectCount,
    fileCount: fileStats.fileCount,
    totalBytes: fileStats.totalBytes,
    totalRuntime: formatBytes(fileStats.totalBytes),
    chartBars,
    periodClips,
    periodProcTime: "—",
    periodRuntime: formatBytes(fileStats.totalBytes),
    periodAvg:
      chartBars.length > 0
        ? (periodClips / chartBars.length).toFixed(1)
        : "0",
  })
}
