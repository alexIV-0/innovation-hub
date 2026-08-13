import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { purgeExpiredTrash } from "@/lib/storage/trash"

export const runtime = "nodejs"

/** POST /api/cron/storage-purge — drop trash older than 30 days. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  const bearer = request.headers.get("authorization")
  if (secret && bearer === `Bearer ${secret}`) {
    const result = await purgeExpiredTrash()
    return NextResponse.json({ ok: true, ...result })
  }

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  const result = await purgeExpiredTrash()
  return NextResponse.json({ ok: true, ...result })
}
