/**
 * Minimal Google OAuth 2.0 client used by /api/auth/google[/callback].
 *
 * We deliberately keep this dependency-free (no `googleapis`) — the entire
 * "Sign in with Google" flow only needs the authorization-code grant + the
 * `userinfo` endpoint, which is a couple of fetch calls.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
}

export type GoogleProfile = {
  /** Stable Google account id ("sub" claim). Use this as the join key. */
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  givenName: string | null
  familyName: string | null
  picture: string | null
}

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GoogleOAuthError"
  }
}

// Kill switch: Google sign-in is temporarily disabled. Flip back to `false`
// to re-enable the "Continue with Google" button and the OAuth routes.
const GOOGLE_OAUTH_DISABLED = true

export function readGoogleOAuthConfig(): GoogleOAuthConfig | null {
  if (GOOGLE_OAUTH_DISABLED) return null

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * Builds the OAuth callback URL.
 *
 * Order of preference:
 *  1. `APP_PUBLIC_URL` — explicit override, useful when you want to pin all
 *     deployments to a single canonical domain (e.g. a custom domain).
 *  2. The host of the incoming request — works on Vercel for both the
 *     production alias and custom domains because the proxy forwards the real
 *     Host/X-Forwarded-Proto headers, which Next.js already reflects in
 *     `request.url`. We deliberately do NOT use `VERCEL_URL` here: that env
 *     var is the *deployment-specific* hostname (e.g. `myapp-abc123.vercel.app`)
 *     and rarely matches what's whitelisted in Google Cloud Console.
 */
export function buildGoogleRedirectUri(request: Request): string {
  const explicit = process.env.APP_PUBLIC_URL?.trim()
  if (explicit) {
    return new URL("/api/auth/google/callback", explicit.replace(/\/$/, "")).toString()
  }
  return new URL("/api/auth/google/callback", request.url).toString()
}

export function buildGoogleAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", input.state)
  // `select_account` makes the chooser appear even when the user has a single
  // active session — friendlier for shared devices and lets people switch
  // Google accounts without signing out from Google itself first.
  url.searchParams.set("prompt", "select_account")
  url.searchParams.set("access_type", "online")
  url.searchParams.set("include_granted_scopes", "true")
  return url.toString()
}

export async function exchangeCodeForToken(input: {
  config: GoogleOAuthConfig
  code: string
  redirectUri: string
}): Promise<{ accessToken: string; idToken?: string; expiresIn?: number }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new GoogleOAuthError(
      `Google token exchange failed (${response.status}): ${text || "no body"}`,
    )
  }

  const data = (await response.json()) as {
    access_token?: string
    id_token?: string
    expires_in?: number
    token_type?: string
  }

  if (!data.access_token) {
    throw new GoogleOAuthError("Google token response missing access_token.")
  }

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    expiresIn: data.expires_in,
  }
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new GoogleOAuthError(
      `Google userinfo fetch failed (${response.status}): ${text || "no body"}`,
    )
  }

  const data = (await response.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    given_name?: string
    family_name?: string
    picture?: string
  }

  if (!data.sub || !data.email) {
    throw new GoogleOAuthError("Google profile is missing sub/email.")
  }

  return {
    sub: data.sub,
    email: data.email,
    emailVerified: Boolean(data.email_verified),
    name: data.name ?? null,
    givenName: data.given_name ?? null,
    familyName: data.family_name ?? null,
    picture: data.picture ?? null,
  }
}
