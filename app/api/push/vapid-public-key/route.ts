import { NextResponse } from "next/server"
import { getVapidPublicKey, isPushConfigured } from "@/lib/push"

export const runtime = "nodejs"

/** Public key is safe to expose — the client needs it to call pushManager.subscribe. */
export async function GET() {
  if (!isPushConfigured()) {
    return NextResponse.json({ message: "Push is not configured." }, { status: 503 })
  }
  return NextResponse.json({ publicKey: getVapidPublicKey() })
}
