import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import { hashPassword } from "@/lib/auth"
import {
  sendProjectAccessGrantedEmail,
  sendProjectInviteWithPasswordEmail,
} from "@/lib/mail/send"
import { syncUserMeta } from "@/lib/project-storage"
import { findOwnedProject } from "@/lib/repositories/projects"
import {
  listProjectMembers,
  removeProjectMember,
  upsertProjectMember,
} from "@/lib/repositories/project-members"
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
} from "@/lib/repositories/users"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["viewer", "editor"]).default("viewer"),
  fullName: z.string().trim().min(1).max(120).optional(),
})

function tempPassword(): string {
  return randomBytes(9).toString("base64url")
}

/** GET /api/projects/:id/members — owner only. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const members = await listProjectMembers(id)
  return NextResponse.json({
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      fullName: m.fullName,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
  })
}

/** POST /api/projects/:id/members — invite by email (owner only). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const email = parsed.data.email.toLowerCase()
  if (email === auth.email.toLowerCase()) {
    return NextResponse.json(
      { message: "You already own this project." },
      { status: 400 },
    )
  }

  let user = await findUserByEmail(email)
  let created = false
  let temporaryPassword: string | null = null

  if (!user) {
    temporaryPassword = tempPassword()
    const passwordHash = await hashPassword(temporaryPassword)
    const fullName =
      parsed.data.fullName?.trim() || email.split("@")[0] || "User"
    const createdUser = await createUser({
      fullName,
      email,
      passwordHash,
    })
    await updateUser(createdUser.id, { mustChangePassword: true })
    user = await findUserByEmail(email)
    if (!user) {
      return NextResponse.json(
        { message: "Could not create user." },
        { status: 500 },
      )
    }
    created = true
    try {
      await syncUserMeta({
        userId: createdUser.id,
        email: createdUser.email,
        createdAt: createdUser.createdAt.toISOString(),
      })
    } catch {
      // best-effort
    }
  }

  if (user.id === project.userId) {
    return NextResponse.json(
      { message: "Owner cannot be added as a member." },
      { status: 400 },
    )
  }

  const member = await upsertProjectMember({
    projectId: project.id,
    userId: user.id,
    role: parsed.data.role,
    invitedBy: auth.userId,
  })

  const inviter = await findUserById(auth.userId)
  const inviterName = inviter?.fullName ?? auth.email
  let mailOk = true
  let mailError: string | null = null

  if (created && temporaryPassword) {
    const mail = await sendProjectInviteWithPasswordEmail({
      to: email,
      inviteeName: user.fullName,
      projectName: project.name,
      role: parsed.data.role,
      inviterName,
      temporaryPassword,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  } else {
    const mail = await sendProjectAccessGrantedEmail({
      to: email,
      inviteeName: user.fullName,
      projectName: project.name,
      role: parsed.data.role,
      inviterName,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  }

  return NextResponse.json({
    member: {
      userId: member.userId,
      email: user.email,
      fullName: user.fullName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
    createdUser: created,
    mailOk,
    mailError,
  })
}

/** DELETE /api/projects/:id/members?userId= */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ message: "userId is required." }, { status: 400 })
  }

  const ok = await removeProjectMember(id, userId)
  if (!ok) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
