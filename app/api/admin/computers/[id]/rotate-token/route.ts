import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  findRemoteComputerById,
  generateRemoteComputerToken,
  rotateRemoteComputerToken,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/** Rotate computer token. Raw token returned once. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  const raw = generateRemoteComputerToken()
  const ok = await rotateRemoteComputerToken(id, raw)
  if (!ok) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  return NextResponse.json({
    id,
    name: existing.name,
    token: raw,
  })
}
