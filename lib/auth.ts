import bcrypt from "bcryptjs"
import { SignJWT, jwtVerify } from "jose"
import type { UserRole } from "@/lib/domain-types"

export const SESSION_COOKIE_NAME = "inhub_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

type SessionPayload = {
  sub: string
  role: UserRole
  email: string
}

function getJwtSecret() {
  const secret = process.env.SESSION_SECRET
  if (secret) {
    return new TextEncoder().encode(secret)
  }

  if (process.env.NODE_ENV !== "production") {
    return new TextEncoder().encode("dev-session-secret-change-me")
  }

  throw new Error("SESSION_SECRET is not configured")
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret())
}

export async function verifySessionToken(token: string) {
  try {
    const verified = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    })

    return {
      userId: verified.payload.sub ?? "",
      role: verified.payload.role as UserRole | undefined,
      email: verified.payload.email as string | undefined,
    }
  } catch {
    return null
  }
}

export function buildSessionCookieConfig() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  }
}
