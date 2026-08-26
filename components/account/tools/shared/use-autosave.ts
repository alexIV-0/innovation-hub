"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { DialogDoc } from "@/lib/tools/dialog/dialog-doc"
import { canonical } from "@/lib/tools/dialog/serialize"

/**
 * Затишье, после которого правки уходят в папку.
 *
 * Секунда с небольшим, а не пятнадцать: человек ждёт, что правка сохранится
 * сразу. Задержка нужна только чтобы протяжка клипа и набор текста уехали одной
 * записью, а не шестьюдесятью.
 */
const QUIET_MS = 1200
/** Дольше этого не тянем даже при непрерывной работе. */
const MAX_WAIT_MS = 8000

export type SaveState =
  | { kind: "clean" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "merged"; taken: number; conflicts: number }
  | { kind: "error"; message: string }

type Options = {
  toolId: string
  doc: DialogDoc | null
  /** Счётчик правок: растёт на каждое изменение документа. */
  version: number
  /** Ревизия, от которой правили. Обновляется после каждой записи. */
  revision: number
  /** Слияние с чужой версией: документ надо принять целиком. */
  onMerged: (doc: DialogDoc) => void
  /** Текст ошибки сети — из словаря, хук строк не знает. */
  networkError: string
}

/**
 * Автосохранение документа задачи.
 *
 * Инструмент работает только онлайн, папка в хранилище — единственное место, где
 * лежат файлы, поэтому «сохранить» здесь означает «записать `dialog.json` в
 * папку». Записью занимается сервер: он же перечитывает папку перед записью и
 * сливает, если документ тронули со стороны (§8 контракта формата).
 */
export function useAutosave({
  toolId,
  doc,
  version,
  revision,
  onMerged,
  networkError,
}: Options) {
  const [state, setState] = useState<SaveState>({ kind: "clean" })

  const docRef = useRef(doc)
  docRef.current = doc
  const revisionRef = useRef(revision)
  const savedVersion = useRef(version)
  const inFlight = useRef(false)
  const dirtySince = useRef<number | null>(null)
  const adopting = useRef(false)
  /** Сколько раз подряд наткнулись на чужую запись. */
  const retries = useRef(0)
  const errorText = useRef(networkError)
  errorText.current = networkError
  /** Версия, которая станет сохранённой после текущей записи. */
  const savedVersionTarget = useRef(version)
  savedVersionTarget.current = version

  // Смена задачи или перезагрузка документа: всё, что было, уже не наше.
  useEffect(() => {
    revisionRef.current = revision
  }, [revision])

  const save = useCallback(async () => {
    const current = docRef.current
    if (!current || inFlight.current) return
    const attempt = savedVersionTarget.current
    inFlight.current = true
    setState({ kind: "saving" })
    try {
      const res = await fetch(`/api/account/tools/${encodeURIComponent(toolId)}/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: canonical(current), baseRevision: revisionRef.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && retries.current < 3) {
        // Документ прямо сейчас пишет кто-то ещё. Это не ошибка человека и не
        // повод его пугать — просто пробуем чуть позже.
        retries.current += 1
        setState({ kind: "pending" })
        setTimeout(() => void save(), 900)
        return
      }
      if (!res.ok) {
        setState({ kind: "error", message: data.message ?? errorText.current })
        return
      }
      retries.current = 0
      revisionRef.current = typeof data.revision === "number" ? data.revision : revisionRef.current
      savedVersion.current = attempt
      dirtySince.current = null
      if (data.merged && data.doc) {
        // Документ у нас теперь неверный: принимаем серверный целиком, а отметку
        // «сохранено» ставим уже на него.
        adopting.current = true
        onMerged(data.doc as DialogDoc)
        setState({
          kind: "merged",
          taken: Number(data.taken ?? 0),
          conflicts: Number(data.conflicts ?? 0),
        })
      } else {
        setState({ kind: "saved", at: String(data.updatedAt ?? new Date().toISOString()) })
      }
    } catch {
      setState({ kind: "error", message: errorText.current })
    } finally {
      inFlight.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMerged, toolId])

  useEffect(() => {
    if (adopting.current) {
      // Принятый серверный документ — это тоже «правка», но сохранять её
      // незачем: она пришла оттуда, куда мы пишем.
      adopting.current = false
      savedVersion.current = version
      dirtySince.current = null
      return
    }
    if (!doc || version === savedVersion.current) return
    if (dirtySince.current == null) dirtySince.current = Date.now()
    setState((current) => (current.kind === "saving" ? current : { kind: "pending" }))

    const waited = Date.now() - dirtySince.current
    const delay = waited >= MAX_WAIT_MS ? 0 : Math.min(QUIET_MS, MAX_WAIT_MS - waited)
    const timer = setTimeout(() => void save(), delay)
    return () => clearTimeout(timer)
  }, [doc, save, version])

  // Запись в полёте закончилась, а правки успели уехать дальше — догоняем.
  useEffect(() => {
    if (state.kind !== "saved" && state.kind !== "merged") return
    if (version === savedVersion.current) return
    const timer = setTimeout(() => void save(), QUIET_MS)
    return () => clearTimeout(timer)
  }, [save, state, version])

  const dirty = Boolean(doc) && version !== savedVersion.current

  // Уход со страницы с несохранёнными правками. Сеть в `beforeunload`
  // ненадёжна, поэтому не пытаемся записать — только предупреждаем.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  /**
   * Записать сейчас — `Cmd/Ctrl+S`, и всё, что должно увидеть свежий документ.
   *
   * Возвращает обещание: тому, кто просит сервер что-то сделать с документом,
   * надо дождаться записи, иначе сервер прочитает версию до правки.
   */
  const flush = useCallback(async () => {
    if (!docRef.current) return
    await save()
  }, [save])

  /**
   * «Это не правка человека».
   *
   * Нужно на открытии задачи: загрузка документа выглядит для счётчика правок
   * так же, как правка, и без этой отметки инструмент записывал бы в папку
   * только что прочитанный файл — на каждое открытие.
   */
  const markClean = useCallback(() => {
    adopting.current = true
  }, [])

  return { state, dirty, flush, markClean, revision: revisionRef.current }
}
