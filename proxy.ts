import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { findUserById } from "@/lib/repositories/users"

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
  if (!session?.userId || session.role !== "ADMIN") {
    return redirectTo(request, "/")
  }

  // Re-validate against the database so that suspending or demoting an admin
  // takes effect immediately, instead of waiting up to 7 days for the JWT
  // cookie to expire. Next.js 16 runs proxy.ts on the Node runtime, so the
  // pg driver is available here.
  const user = await findUserById(session.userId)
  if (!user || !user.isActive || user.role !== "ADMIN") {
    return redirectTo(request, "/login")
  }

  return withAdminNoCache(NextResponse.next())
}

export const config = {
  matcher: ["/admin/:path*"],
}
