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
  type ProjectMemberRole,
} from "@/lib/repositories/project-members"
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
} from "@/lib/repositories/users"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const inviteSchema = z
  .object({
    email: z.string().email().optional(),
    emails: z.array(z.string().email()).max(20).optional(),
    role: z.enum(["viewer", "editor"]).default("viewer"),
    fullName: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((data, ctx) => {
    const count =
      (data.email ? 1 : 0) + (data.emails?.length ?? 0)
    if (count === 0) {
      ctx.addIssue({
        code: "custom",
        message: "At least one email is required.",
      })
    }
  })

const patchSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["viewer", "editor"]),
})

function tempPassword(): string {
  return randomBytes(9).toString("base64url")
}

function uniqueEmails(parsed: z.infer<typeof inviteSchema>): string[] {
  const raw = [
    ...(parsed.email ? [parsed.email] : []),
    ...(parsed.emails ?? []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const email = item.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

type InviteOk = {
  email: string
  ok: true
  createdUser: boolean
  mailOk: boolean
  mailError: string | null
  member: {
    userId: string
    email: string
    fullName: string
    role: ProjectMemberRole
    createdAt: string
  }
}

type InviteFail = {
  email: string
  ok: false
  message: string
}

async function inviteOne(input: {
  projectId: string
  projectName: string
  projectOwnerId: string
  actorUserId: string
  actorEmail: string
  inviterName: string
  email: string
  role: ProjectMemberRole
  fullName?: string
}): Promise<InviteOk | InviteFail> {
  if (input.email === input.actorEmail.toLowerCase()) {
    return {
      email: input.email,
      ok: false,
      message: "You already own this project.",
    }
  }

  let user = await findUserByEmail(input.email)
  let created = false
  let temporaryPassword: string | null = null

  if (!user) {
    temporaryPassword = tempPassword()
    const passwordHash = await hashPassword(temporaryPassword)
    const fullName =
      input.fullName?.trim() || input.email.split("@")[0] || "User"
    const createdUser = await createUser({
      fullName,
      email: input.email,
      passwordHash,
    })
    await updateUser(createdUser.id, { mustChangePassword: true })
    user = await findUserByEmail(input.email)
    if (!user) {
      return {
        email: input.email,
        ok: false,
        message: "Could not create user.",
      }
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

  if (user.id === input.projectOwnerId) {
    return {
      email: input.email,
      ok: false,
      message: "Owner cannot be added as a member.",
    }
  }

  const member = await upsertProjectMember({
    projectId: input.projectId,
    userId: user.id,
    role: input.role,
    invitedBy: input.actorUserId,
  })

  let mailOk = true
  let mailError: string | null = null

  if (created && temporaryPassword) {
    const mail = await sendProjectInviteWithPasswordEmail({
      to: input.email,
      inviteeName: user.fullName,
      projectName: input.projectName,
      role: input.role,
      inviterName: input.inviterName,
      temporaryPassword,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  } else {
    const mail = await sendProjectAccessGrantedEmail({
      to: input.email,
      inviteeName: user.fullName,
      projectName: input.projectName,
      projectId: input.projectId,
      role: input.role,
      inviterName: input.inviterName,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  }

  return {
    email: input.email,
    ok: true,
    createdUser: created,
    mailOk,
    mailError,
    member: {
      userId: member.userId,
      email: user.email,
      fullName: user.fullName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
  }
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

  const [members, owner] = await Promise.all([
    listProjectMembers(id),
    findUserById(project.userId),
  ])
  return NextResponse.json({
    owner: {
      userId: project.userId,
      email: owner?.email ?? auth.email,
      fullName: owner?.fullName ?? auth.email,
    },
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

  const emails = uniqueEmails(parsed.data)
  const inviter = await findUserById(auth.userId)
  const inviterName = inviter?.fullName ?? auth.email

  const results: Array<InviteOk | InviteFail> = []
  for (const email of emails) {
    results.push(
      await inviteOne({
        projectId: project.id,
        projectName: project.name,
        projectOwnerId: project.userId,
        actorUserId: auth.userId,
        actorEmail: auth.email,
        inviterName,
        email,
        role: parsed.data.role,
        fullName: parsed.data.fullName,
      }),
    )
  }

  const invited = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const status = invited.length === 0 ? 400 : 200

  return NextResponse.json(
    {
      results,
      invited: invited.length,
      failed: failed.length,
      // Backward-compatible single-invite fields
      member: invited[0]?.ok ? invited[0].member : undefined,
      createdUser: invited[0]?.ok ? invited[0].createdUser : undefined,
      mailOk: invited[0]?.ok ? invited[0].mailOk : undefined,
      mailError: invited[0]?.ok ? invited[0].mailError : undefined,
      message: failed[0] && !failed[0].ok ? failed[0].message : undefined,
    },
    { status },
  )
}

/** PATCH /api/projects/:id/members — change a member's role (owner only). */
export async function PATCH(request: NextRequest, { params }: Params) {
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
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  if (parsed.data.userId === project.userId || parsed.data.userId === auth.userId) {
    return NextResponse.json(
      { message: "Owner role cannot be changed." },
      { status: 400 },
    )
  }

  const existing = (await listProjectMembers(id)).find(
    (m) => m.userId === parsed.data.userId,
  )
  if (!existing) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 })
  }

  const member = await upsertProjectMember({
    projectId: project.id,
    userId: parsed.data.userId,
    role: parsed.data.role,
    invitedBy: existing.invitedBy ?? auth.userId,
  })

  return NextResponse.json({
    member: {
      userId: member.userId,
      email: existing.email,
      fullName: existing.fullName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
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
