"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, MessageSquare, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type ProjectChatMessageDto = {
  id: string
  senderType: "client" | "team" | "system"
  senderName: string
  body: string
  delivered: boolean
  createdAt: string
}

type Props = {
  projectId: string
  initialMessages: ProjectChatMessageDto[]
  /** Compact = embedded in the project detail page; false = the full chat page. */
  compact?: boolean
}

const POLL_INTERVAL_MS = 6000

function formatTime(iso: string) {
  try {
    // Fixed locale: SSR and the browser must produce identical text.
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

/** Merges freshly-polled/sent messages into the list, de-duplicated by id. */
function mergeMessages(
  prev: ProjectChatMessageDto[],
  incoming: ProjectChatMessageDto[],
): ProjectChatMessageDto[] {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

export function ProjectChatPanel({
  projectId,
  initialMessages,
  compact = false,
}: Props) {
  const [messages, setMessages] = useState(initialMessages)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingIds = useRef(new Set<string>())

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
    // Only on mount — later updates scroll explicitly after send/poll below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        credentials: "same-origin",
      })
      if (!response.ok) return
      const data = (await response.json().catch(() => null)) as {
        messages?: ProjectChatMessageDto[]
      } | null
      if (!data?.messages) return
      setMessages((prev) => {
        const merged = mergeMessages(prev, data.messages!)
        return merged
      })
    } catch {
      // Silent — polling retries on the next tick regardless.
    }
  }, [projectId])

  useEffect(() => {
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [poll])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  const onSend = async () => {
    const body = text.trim()
    if (!body || sending) return

    const tempId = `temp-${Date.now()}`
    const optimistic: ProjectChatMessageDto = {
      id: tempId,
      senderType: "client",
      senderName: "You",
      body,
      delivered: false,
      createdAt: new Date().toISOString(),
    }
    pendingIds.current.add(tempId)
    setMessages((prev) => [...prev, optimistic])
    setText("")
    setSending(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      })
      const data = (await response.json().catch(() => null)) as {
        message?: ProjectChatMessageDto | string
        errors?: unknown
      } | null

      if (!response.ok || !data?.message || typeof data.message === "string") {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        toast.error(
          typeof data?.message === "string"
            ? data.message
            : "Could not send message.",
        )
        return
      }

      pendingIds.current.delete(tempId)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        data.message as ProjectChatMessageDto,
      ])
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error("Unable to reach the server.")
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40",
        compact ? "h-[28rem]" : "h-[65vh] min-h-[28rem]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Project chat
        </h2>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages yet. Send us a note about this project and our team
            will reply here.
          </p>
        ) : (
          messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border/60 px-4 py-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
          placeholder="Write a message…"
          rows={1}
          className="min-h-[2.5rem] flex-1 resize-none"
        />
        <Button
          type="button"
          size="icon"
          disabled={sending || !text.trim()}
          onClick={() => void onSend()}
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </section>
  )
}

function ChatBubble({ message }: { message: ProjectChatMessageDto }) {
  const isClient = message.senderType === "client"
  const isSystem = message.senderType === "system"

  if (isSystem) {
    return (
      <p className="py-1 text-center text-xs text-muted-foreground/70">
        {message.body}
      </p>
    )
  }

  return (
    <div className={cn("flex", isClient ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isClient
            ? "bg-primary/15 text-foreground"
            : "border border-border/60 bg-white/[0.03] text-foreground",
        )}
      >
        <p className="mb-0.5 text-xs font-medium text-muted-foreground">
          {isClient ? "You" : message.senderName}
          {" · "}
          {formatTime(message.createdAt)}
          {isClient && !message.delivered && !message.id.startsWith("temp-")
            ? " · sending…"
            : null}
        </p>
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
      </div>
    </div>
  )
}
