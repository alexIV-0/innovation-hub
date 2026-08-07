import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"

export const runtime = "nodejs"

/**
 * GET /api/storage/v1/capabilities
 * Feature flags for storage clients (avoid hardcoding supported ops).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({
    apiVersion: 1,
    multipart: false,
    rename: true,
    copy: false,
    sharing: false,
    clients: true,
    originMtime: true,
    contentHash: true,
  })
}
