import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listUsers } from "@/lib/repositories/users"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const users = await listUsers()
  return NextResponse.json(users)
}
