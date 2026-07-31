import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createProjectSchema } from "@/lib/project-schemas"
import {
  createProject,
  listProjectsByOwner,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const projects = await listProjectsByOwner(auth.userId)
  return NextResponse.json({ projects })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const project = await createProject({
    ownerId: auth.userId,
    name: parsed.data.name,
    description: parsed.data.description,
    groupName: parsed.data.groupName,
  })

  return NextResponse.json({ project }, { status: 201 })
}
