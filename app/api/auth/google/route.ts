import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildGoogleAuthorizeUrl,
  buildGoogleRedirectUri,
  readGoogleOAuthConfig,
} from "@/lib/google-oauth"

export const dynamic = "force-dynamic"

const GOOGLE_STATE_COOKIE = "google_oauth_state"
const GOOGLE_NEXT_COOKIE = "google_oauth_next"
const STATE_TTL_SECONDS = 10 * 60

function safeNextPath(value: string | null): string {
  if (!value) return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value
}

export async function GET(request: Request) {
  const config = readGoogleOAuthConfig()
  if (!config) {
    return NextResponse.json(
      { message: "Google sign-in is not configured on this server." },
      { status: 501 },
    )
  }

  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get("next"))
  const state = randomBytes(24).toString("hex")
  const redirectUri = buildGoogleRedirectUri(request)

  const authorizeUrl = buildGoogleAuthorizeUrl({
    clientId: config.clientId,
    redirectUri,
    state,
  })

  const response = NextResponse.redirect(authorizeUrl)
  const isProd = process.env.NODE_ENV === "production"
  const cookieBase = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/api/auth/google",
    maxAge: STATE_TTL_SECONDS,
  }
  response.cookies.set(GOOGLE_STATE_COOKIE, state, cookieBase)
  response.cookies.set(GOOGLE_NEXT_COOKIE, next, cookieBase)
  return response
}
