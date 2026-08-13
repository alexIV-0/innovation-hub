import { NextResponse, type NextRequest } from "next/server"
import { dispatchMachineApi } from "@/lib/machine-api/dispatch"

export const runtime = "nodejs"
export const maxDuration = 120

/** POST /api/v1 — single entry for remote computers. */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  return dispatchMachineApi(body)
}

export async function GET() {
  return NextResponse.json(
    { message: "Use POST /api/v1 with { action, props, token }." },
    { status: 405, headers: { Allow: "POST" } },
  )
}
