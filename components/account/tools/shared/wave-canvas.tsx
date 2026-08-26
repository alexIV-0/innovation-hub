"use client"

import { useEffect, useRef } from "react"

import { peakBars, type Peaks } from "@/lib/tools/dialog/peaks"
import { readToken } from "./tokens"
import type { ViewportSource } from "./viewport"

type WaveCanvasProps = {
  peaks: Peaks | null
  /** Пикселей на секунду. */
  pps: number
  /** Высота полосы волны, а не всей дорожки: она живёт у нижнего края. */
  height: number
  /** Цвет дорожки из документа; `null` — общая волна, её цвет берём из токенов. */
  color: string | null
  opacity: number
  viewport: ViewportSource
  className?: string
}

/**
 * Волна дорожки: canvas на видимую часть полотна.
 *
 * Столбиками по одному на пиксель, без сглаживания: кривая, которой в данных
 * нет, выглядела бы точнее, чем есть на самом деле (§17.3). Перерисовка только
 * когда что-то изменилось: скролл, зум, высота, цвет.
 *
 * Волна прижата к нижнему краю и рисуется размахом вверх, а не симметрично от
 * середины. Причина простая: по центру дорожки лежат клипы титров, и волна под
 * ними пропадала — а именно по ней видно, где реально началась речь.
 */
export function WaveCanvas({
  peaks,
  pps,
  height,
  color,
  opacity,
  viewport,
  className,
}: WaveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const props = useRef({ peaks, pps, height, color, opacity })
  props.current = { peaks, pps, height, color, opacity }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = (view: { left: number; width: number }) => {
      const { peaks: data, pps: scale, height: h, color: stroke, opacity: alpha } = props.current
      const width = Math.max(0, Math.ceil(view.width))
      const dpr = window.devicePixelRatio || 1
      canvas.style.left = `${view.left}px`
      canvas.style.width = `${width}px`
      canvas.style.height = `${h}px`
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, h)
      if (!data || width === 0 || h === 0) return

      // Полотно рисуется от нуля, окно — кусок посередине: сдвигаем начало
      // выборки на смещение скролла, чтобы столбик остался под своей секундой.
      const pxPerMs = scale / 1000
      const bars = peakBars(data, width, pxPerMs, view.left)
      ctx.globalAlpha = alpha
      ctx.fillStyle = stroke ?? readToken(canvas, "--ws-text-3")
      for (let x = 0; x < width; x += 1) {
        // Размах пары min/max — одна величина: полуволна вниз от нижнего края
        // всё равно не поместится, а разница между «тихо» и «громко» видна и так.
        const amplitude = Math.max(Math.abs(bars.min[x]), Math.abs(bars.max[x]))
        const barHeight = Math.max(1, amplitude * h)
        ctx.fillRect(x, h - barHeight, 1, barHeight)
      }
      ctx.globalAlpha = 1
    }

    return viewport.subscribe(draw)
  }, [viewport, peaks, pps, height, color, opacity])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ position: "absolute", bottom: 0, pointerEvents: "none" }}
    />
  )
}
