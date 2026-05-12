import { z } from "zod"
import { NextResponse } from "next/server"
import { hashPassword } from "@/lib/auth"
import { createUser, findUserByEmail } from "@/lib/repositories/users"

const signupRequestSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
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

  const email = parsed.data.email.toLowerCase()
  const existing = await findUserByEmail(email)
  if (existing) {
    return NextResponse.json(
      { message: "User with this email already exists." },
      { status: 409 },
    )
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password)
    await createUser({
      fullName: parsed.data.fullName,
      email,
      passwordHash,
    })
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "User with this email already exists." },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { message: "Unable to create account right now." },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      message: `Account for ${parsed.data.fullName} created successfully.`,
    },
    { status: 201 },
  )
}
