import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/admin-auth"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import { isElevated } from "@/lib/admin-roles"

/**
 * Гейт админской страницы по тегу.
 *
 * Нужен вдобавок к скрытому пункту меню и к 403 из API: без него человек,
 * пришедший по прямой ссылке, увидел бы пустой каркас раздела и вереницу
 * неудачных запросов вместо внятного «сюда нельзя». Редирект на обзор, а не
 * 403-страница: раздел для него просто не существует.
 */
export async function requireCapabilityPage(capability: AdminCapability) {
  const user = await getCurrentUser()
  if (!user || !user.isActive || !isElevated(user.role)) {
    redirect("/login")
  }
  if (!hasCapability(user.role, user.capabilities, capability)) {
    redirect("/admin")
  }
  return user
}
