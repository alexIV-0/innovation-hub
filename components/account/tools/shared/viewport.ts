"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"

/** Видимая часть полотна таймлинии: смещение скролла и ширина окна. */
export type Viewport = { left: number; top: number; width: number }

export type ViewportSource = {
  get: () => Viewport
  subscribe: (listener: (viewport: Viewport) => void) => () => void
}

/**
 * Окно просмотра таймлинии — подпиской, а не состоянием.
 *
 * Полотно длинное: десять минут при 320 px/с — это больше двухсот тысяч
 * пикселей, столько не рисует ни один canvas. Поэтому волна и линейка рисуют
 * только видимый кусок и перерисовываются при скролле; складывать смещение в
 * состояние React значило бы перерисовывать все клипы на каждый кадр прокрутки.
 */
export function useViewportSource(
  scroller: React.RefObject<HTMLElement | null>,
): ViewportSource {
  const value = useRef<Viewport>({ left: 0, top: 0, width: 0 })
  const listeners = useRef(new Set<(viewport: Viewport) => void>())

  const publish = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const next = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth }
    if (
      next.left === value.current.left &&
      next.top === value.current.top &&
      next.width === value.current.width
    ) {
      return
    }
    value.current = next
    for (const listener of listeners.current) listener(next)
  }, [scroller])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        publish()
      })
    }
    publish()
    el.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [publish, scroller])

  const subscribe = useCallback((listener: (viewport: Viewport) => void) => {
    listeners.current.add(listener)
    listener(value.current)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  // Объект стабильный: подписчики держат его в зависимостях эффекта, и новый
  // объект на каждый рендер перерисовывал бы все волны на пустом месте.
  return useMemo(() => ({ get: () => value.current, subscribe }), [subscribe])
}
