import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"

function withNoCacheForHtml(request: NextRequest, response: NextResponse) {
  const accept = request.headers.get("accept") ?? ""
  if (accept.includes("text/html")) {
    response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("Expires", "0")
  }
  return response
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (!pathname.startsWith("/admin")) {
    return withNoCacheForHtml(request, NextResponse.next())
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return withNoCacheForHtml(
      request,
      NextResponse.redirect(new URL("/login", request.url))
    )
  }

  const session = await verifySessionToken(token)
  if (!session || session.role !== "ADMIN") {
    return withNoCacheForHtml(
      request,
      NextResponse.redirect(new URL("/", request.url))
    )
  }

  return withNoCacheForHtml(request, NextResponse.next())
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
}
