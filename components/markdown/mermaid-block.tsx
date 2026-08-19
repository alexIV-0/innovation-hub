"use client"

import { useEffect, useId, useRef, useState } from "react"

/**
 * Блок-схема из фенса ```mermaid (контракт §5: рисует сайт, программа только
 * хранит текст).
 *
 * Пакет тянется динамическим import внутри эффекта: он весит ~2–3 МБ, а
 * диаграмма есть далеко не в каждом описании — так она не попадает в бандл
 * страницы, а грузится только когда встретилась.
 *
 * Тема собирается из токенов через `getComputedStyle`, а не из hex: UI_TOKENS
 * запрещает хардкод цвета, а mermaid принимает готовые CSS-значения.
 *
 * Не разобралось — показываем исходный текст блоком кода. Никогда не ошибкой и
 * не пустотой: это правило контракта для обеих сторон.
 */
export function MermaidBlock({ chart }: { chart: string }) {
  const host = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  // useId даёт `:r1:` — двоеточия ломают и селекторы, и id внутри SVG.
  const domId = `md-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`

  useEffect(() => {
    let alive = true
    setFailed(false)

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default
        if (!alive) return

        const token = (name: string, alpha?: number): string | undefined => {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim()
          if (!raw) return undefined
          return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`
        }

        mermaid.initialize({
          startOnLoad: false,
          // Текст диаграммы приходит из файла описания, доверенным он не
          // является: strict выключает html-подписи и чистит содержимое.
          securityLevel: "strict",
          theme: "dark",
          fontFamily: "inherit",
          themeVariables: {
            background: token("--ws-well"),
            primaryColor: token("--primary", 0.22),
            primaryBorderColor: token("--primary"),
            primaryTextColor: token("--ws-text-1"),
            secondaryColor: token("--chart-2", 0.22),
            tertiaryColor: token("--chart-3", 0.22),
            lineColor: token("--ws-text-4"),
            textColor: token("--ws-text-2"),
          },
        })

        const { svg } = await mermaid.render(domId, chart)
        if (!alive || !host.current) return
        host.current.innerHTML = svg
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [chart, domId])

  if (failed) {
    return (
      <pre>
        <code className="language-mermaid">{chart}</code>
      </pre>
    )
  }

  return <div ref={host} className="md-mermaid" />
}
