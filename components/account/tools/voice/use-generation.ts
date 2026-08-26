"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { DialogDoc, VoiceTake } from "@/lib/tools/dialog/dialog-doc"
import { selectedTake, synthText } from "@/lib/tools/dialog/voice"
import type { GenState } from "./voice-context"

type Options = {
  toolId: string
  doc: DialogDoc | null
  /** Язык, который озвучиваем. */
  lang: string
  /** Сколько запросов держать в полёте. */
  concurrency: number
  /** Готовый тейк вписывает в документ вызывающий: документом владеет он. */
  onTake: (cueId: string, take: VoiceTake) => void
  /** Текст ошибки сети — из словаря, хук строк не знает. */
  networkError: string
  /**
   * Что сделать перед запросом.
   *
   * Роут читает документ из папки, а правка разметки уходит туда автосохранением
   * с задержкой. Без этой паузы «поправил и нажал озвучить» синтезировало бы
   * текст до правки — и человек не понял бы, почему.
   */
  beforeRequest?: () => Promise<void>
}

/**
 * Очередь генерации.
 *
 * Состояние живёт в памяти вкладки: это состояние интерфейса, а не результат
 * работы. Готовый тейк — уже запись в документе, и дальше он идёт обычным путём
 * через автосохранение.
 *
 * Одновременных запросов немного (по умолчанию два): провайдер внешний и с
 * ограничениями по частоте, и двадцать параллельных вернут ошибки вместо звука.
 *
 * Перезагрузка страницы теряет очередь. Это принято сознательно на первую
 * версию: задания живут на клиенте, а когда появится настоящий бэкенд, очередь
 * переедет на сервер и станет спрашиваемой.
 */
export function useGenerationQueue({
  toolId,
  doc,
  lang,
  concurrency,
  onTake,
  networkError,
  beforeRequest,
}: Options) {
  const [states, setStates] = useState<Record<string, GenState>>({})
  const queue = useRef<string[]>([])
  const running = useRef(new Set<string>())
  const cancelled = useRef(false)

  const docRef = useRef(doc)
  docRef.current = doc
  const langRef = useRef(lang)
  langRef.current = lang
  const onTakeRef = useRef(onTake)
  onTakeRef.current = onTake
  const errorRef = useRef(networkError)
  errorRef.current = networkError
  const limitRef = useRef(concurrency)
  limitRef.current = Math.max(1, concurrency)
  const beforeRef = useRef(beforeRequest)
  beforeRef.current = beforeRequest

  // Смена задачи или языка обнуляет очередь: то, что стояло в ней, относилось к
  // другому материалу.
  useEffect(() => {
    queue.current = []
    running.current.clear()
    cancelled.current = false
    setStates({})
  }, [toolId, lang])

  const mark = useCallback((cueId: string, state: GenState) => {
    setStates((current) => ({ ...current, [cueId]: state }))
  }, [])

  const pump = useCallback(() => {
    while (running.current.size < limitRef.current && queue.current.length > 0) {
      const cueId = queue.current.shift()
      if (!cueId) break
      running.current.add(cueId)
      mark(cueId, { kind: "running" })

      void (async () => {
        try {
          await beforeRef.current?.()
          const res = await fetch(
            `/api/account/tools/${encodeURIComponent(toolId)}/voice/generate`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cueId, lang: langRef.current }),
            },
          )
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.take) {
            mark(cueId, { kind: "failed", message: data.message ?? errorRef.current })
            return
          }
          onTakeRef.current(cueId, data.take as VoiceTake)
          mark(cueId, { kind: "idle" })
        } catch {
          mark(cueId, { kind: "failed", message: errorRef.current })
        } finally {
          running.current.delete(cueId)
          if (!cancelled.current) pump()
        }
      })()
    }
  }, [mark, toolId])

  const enqueue = useCallback(
    (cueIds: string[]) => {
      const fresh = cueIds.filter(
        (id) => !running.current.has(id) && !queue.current.includes(id),
      )
      if (fresh.length === 0) return
      cancelled.current = false
      queue.current.push(...fresh)
      setStates((current) => {
        const next = { ...current }
        for (const id of fresh) next[id] = { kind: "queued" }
        return next
      })
      pump()
    },
    [pump],
  )

  const generate = useCallback((cueId: string) => enqueue([cueId]), [enqueue])

  /**
   * Озвучить всё, что ещё не озвучено на этом языке.
   *
   * Реплики без текста пропускаем: синтезировать пустоту нечего, а место в
   * очереди она бы заняла.
   */
  const generateAll = useCallback(() => {
    const current = docRef.current
    if (!current) return
    enqueue(
      current.cues
        .filter((cue) => !selectedTake(cue, langRef.current))
        .filter((cue) => synthText(current, cue, langRef.current).trim().length > 0)
        .map((cue) => cue.id),
    )
  }, [enqueue])

  /** Отменить то, что ещё не ушло. Начатое дорабатывает: байты уже пишутся. */
  const cancelAll = useCallback(() => {
    cancelled.current = true
    const dropped = queue.current
    queue.current = []
    setStates((current) => {
      const next = { ...current }
      for (const id of dropped) next[id] = { kind: "idle" }
      return next
    })
  }, [])

  const state = useCallback(
    (cueId: string): GenState => states[cueId] ?? { kind: "idle" },
    [states],
  )

  const pending =
    Object.values(states).filter((s) => s.kind === "queued" || s.kind === "running").length

  return { state, pending, generate, generateAll, cancelAll }
}
