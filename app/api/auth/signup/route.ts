import { z } from "zod"
import { NextResponse } from "next/server"

const signupRequestSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
})

export async function POST(request: Request) {
  const payload = await request.json()
  const parsed = signupRequestSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid registration data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  return NextResponse.json(
    {
      message: `Account for ${parsed.data.fullName} created successfully (mock).`,
    },
    { status: 201 },
  )
}
