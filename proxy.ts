import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { isElevated } from "@/lib/admin-roles"

/**
 * Disable HTML caching ONLY for the admin surface — the public marketing
 * pages and video catalog should remain CDN-cacheable.
 */
function withAdminNoCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  return response
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return withAdminNoCache(NextResponse.redirect(new URL(path, request.url)))
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return redirectTo(request, "/login")
  }

  const session = await verifySessionToken(token)
  if (!session?.userId || !isElevated(session.role)) {
    return redirectTo(request, "/")
  }

  // Only the cheap JWT check runs here. The authoritative isActive/role
  // re-validation against the database happens once in app/admin/layout.tsx
  // (and in every /api/admin handler via requireAdminApi), so a suspended or
  // demoted admin is still bounced immediately — without paying a Postgres
  // round-trip in the proxy on every admin navigation.
  return withAdminNoCache(NextResponse.next())
}

export const config = {
  matcher: ["/admin/:path*"],
}
