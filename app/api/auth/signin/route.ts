import { NextResponse } from "next/server"
import { loginSchema } from "@/lib/auth-schemas"

export async function POST(request: Request) {
  const payload = await request.json()
  const parsed = loginSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid credentials format.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  return NextResponse.json(
    {
      message: `Welcome back, ${parsed.data.email}. Mock sign-in completed.`,
    },
    { status: 200 },
  )
}
