import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import { STORAGE_CAPABILITIES } from "@/lib/storage/capabilities"

export const runtime = "nodejs"

/**
 * GET /api/storage/v1/capabilities
 * Feature flags for storage clients (avoid hardcoding supported ops).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  return NextResponse.json(STORAGE_CAPABILITIES)
}
