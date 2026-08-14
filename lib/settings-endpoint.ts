import { NextResponse } from "next/server"
import {
  SettingsValidationError,
  readSettings,
  writeSettings,
  type SettingsDomain,
} from "@/lib/repositories/automation-settings"
import type { SettingsWriteInput } from "@/lib/settings-schemas"

/**
 * Общая логика всех трёх поверхностей общих словарей (docs/SETTINGS_SYNC.md §7):
 * `/api/storage/v1/settings` для десктопа, экшены `POST /api/v1` для машин
 * конвейера, `/api/admin/settings` для браузера.
 *
 * Роуты остаются тонкими: их дело — авторизоваться своим способом и разобрать
 * тело. Права и семантика ответа (включая форму 409) — здесь, иначе поверхности
 * разъедутся, и десктоп начнёт видеть не то же, что сайт.
 */

/** Минимум, который нужен от любой из трёх схем авторизации. */
export type SettingsCaller = {
  userId: string
  role: string
  /** Токен машины или компьютера — не сессия браузера. */
  isMachine: boolean
}

/**
 * Читать может любой авторизованный: редактору нод нужен список типов, чтобы
 * показать его на выбор. Писать — админ или машина.
 */
export function canWriteSettings(caller: SettingsCaller): boolean {
  return caller.role === "ADMIN" || caller.isMachine
}

export async function respondWithSettings(
  only?: SettingsDomain[],
): Promise<NextResponse> {
  const document = await readSettings(only)
  return NextResponse.json(document)
}

export async function applySettingsWrite(
  caller: SettingsCaller,
  input: SettingsWriteInput,
): Promise<NextResponse> {
  if (!canWriteSettings(caller)) {
    return NextResponse.json(
      { message: "Only an administrator can change shared settings." },
      { status: 403 },
    )
  }

  try {
    const result = await writeSettings({
      baseRevision: input.baseRevision,
      domains: input.domains,
      // Машина пишет от имени своего пользователя; для сессии это сам админ.
      updatedBy: caller.userId,
    })

    if (!result.ok) {
      // 409 — не ошибка, а нормальный ответ протокола: отдаём текущее состояние,
      // чтобы клиент слил три стороны и повторил. Тело обязано содержать
      // документ целиком, иначе клиенту пришлось бы делать ещё один запрос
      // и сливать уже с третьей, снова успевшей устареть версией.
      return NextResponse.json(
        { error: result.reason, ...result.document },
        { status: 409 },
      )
    }

    return NextResponse.json(result.document)
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return NextResponse.json({ message: error.message }, { status: 400 })
    }
    console.error("[settings] write failed", error)
    return NextResponse.json(
      { message: "Failed to save settings." },
      { status: 503 },
    )
  }
}
