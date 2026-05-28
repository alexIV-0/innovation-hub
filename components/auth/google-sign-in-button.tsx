"use client"

import { Button } from "@/components/ui/button"

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 3.21.59 4.4 1.74l3.27-3.27C14.69.36 12.04-.5 9-.5 5.48-.5 2.44 1.5.96 4.41l3.79 2.94C5.5 5.18 7.06 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.13-.86 2.09-1.83 2.73l2.96 2.29c1.73-1.6 2.73-3.96 2.73-6.67z"
      />
      <path
        fill="#FBBC05"
        d="M4.75 10.71c-.22-.66-.35-1.36-.35-2.08 0-.72.13-1.42.35-2.08L.96 3.61C.34 4.84 0 6.22 0 7.63s.34 2.79.96 4.02l3.79-2.94z"
      />
      <path
        fill="#34A853"
        d="M9 17.5c2.43 0 4.47-.8 5.96-2.18l-2.96-2.29c-.82.55-1.87.87-3 .87-2.31 0-4.27-1.56-4.97-3.66L.24 13.18C1.72 16.09 4.71 17.5 9 17.5z"
      />
    </svg>
  )
}

type Props = {
  /** Path to return the user to after a successful sign-in. */
  next?: string
  /** Override label (defaults to "Continue with Google"). */
  label?: string
}

export function GoogleSignInButton({ next, label = "Continue with Google" }: Props) {
  const params = new URLSearchParams()
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    params.set("next", next)
  }
  const href = `/api/auth/google${params.size ? `?${params.toString()}` : ""}`

  return (
    <Button asChild variant="outline" type="button" className="w-full gap-2">
      <a href={href}>
        <GoogleGlyph />
        {label}
      </a>
    </Button>
  )
}
