"use client"

import { useCallback, useEffect, useState } from "react"

export type AdminDensity = "full" | "simple"

/**
 * Полный вид (колонка инструментов видна) или упрощённый (скрыта).
 *
 * Ключ свой, отдельный от `ffworks-ws-density` кабинета. Соблазн переиспользовать
 * тот был, но свернув колонку инструментов в админке, человек не ожидает, что у
 * него заодно схлопнется список проектов в кабинете. Одинаково выглядит — не
 * значит одно и то же состояние.
 *
 * Первый рендер всегда «full»: на сервере localStorage нет, и угадай мы иначе —
 * колонка мигала бы при гидрации.
 */
const STORAGE_KEY = "ffworks-admin-density"

export function useAdminDensity() {
  const [density, setDensityState] = useState<AdminDensity>("full")

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === "full" || stored === "simple") setDensityState(stored)
    } catch {
      // Приватный режим или запрет на хранилище — остаёмся на полном виде.
    }
  }, [])

  const setDensity = useCallback((next: AdminDensity) => {
    setDensityState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Не сохранилось — вид всё равно переключился на эту сессию.
    }
  }, [])

  return { density, setDensity }
}
