import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  forgetShareContact,
  listShareContacts,
} from "@/lib/repositories/share-contacts"

export const runtime = "nodejs"

/**
 * Кого этот пользователь уже приглашал в проекты.
 *
 * Пишется не здесь, а в POST /api/projects/:id/members: запись — след удавшегося
 * приглашения, и доверять её клиенту незачем. Тут только чтение и «забыть».
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const contacts = await listShareContacts(auth.userId)
  return NextResponse.json({
    contacts: contacts.map((c) => ({
      email: c.email,
      fullName: c.fullName,
      lastUsedAt: c.lastUsedAt.toISOString(),
    })),
  })
}

/** DELETE /api/account/share-contacts?email= — убрать адрес из подсказок. */
export async function DELETE(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const email = request.nextUrl.searchParams.get("email")
  if (!email) {
    return NextResponse.json({ message: "email is required." }, { status: 400 })
  }

  // Записи нет — считаем, что цель достигнута: подсказка могла уйти из другой
  // вкладки, и ошибка здесь только мешала бы.
  await forgetShareContact(auth.userId, email)
  return NextResponse.json({ ok: true })
}
