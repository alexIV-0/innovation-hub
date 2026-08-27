import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listAccessTokens } from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

/**
 * Токены доступа с машинами под ними — один список для страницы «Удалённый доступ».
 *
 * Токены двух механизмов (`rc_` компьютера и `mch_` машины) отдаются вперемешку
 * намеренно: для человека это одно понятие — «ключ, который я завёл и скопировал в
 * машину», и разделять их в интерфейсе значило бы навязывать ему устройство бэкенда.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({ tokens: await listAccessTokens() })
}
