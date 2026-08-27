import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  getVisitorStats,
  listVisitorEvents,
  listVisitorGroups,
} from "@/lib/repositories/visitor-events"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function parseAudience(
  value: string | null,
): "all" | "authenticated" | "anonymous" {
  if (value === "authenticated" || value === "anonymous") return value
  return "all"
}

function parseSinceParam(value: string | null): Date | undefined {
  switch (value) {
    case "24h":
      return new Date(Date.now() - 24 * 60 * 60 * 1000)
    case "7d":
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    default:
      return undefined
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "visitors.view")
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)

  const audience = parseAudience(searchParams.get("audience"))
  const since = parseSinceParam(searchParams.get("since"))
  const search = searchParams.get("q") ?? undefined
  const view = searchParams.get("view") ?? "events"
  const limit = Number(searchParams.get("limit") ?? "100")
  const offset = Number(searchParams.get("offset") ?? "0")

  const [stats, events, groups] = await Promise.all([
    getVisitorStats(),
    view === "events" || view === "all"
      ? listVisitorEvents({ audience, since, search, limit, offset })
      : Promise.resolve([]),
    view === "groups" || view === "all"
      ? listVisitorGroups({ audience, since, search, limit })
      : Promise.resolve([]),
  ])

  return NextResponse.json({ stats, events, groups })
}
