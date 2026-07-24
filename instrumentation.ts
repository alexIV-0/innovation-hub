/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Used to kick off the background chat push poller (see
 * lib/chat-push-poller.ts) so it's running before any request comes in.
 * Guarded to the Node runtime since this touches Postgres/web-push, neither
 * of which work in the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startChatPushPoller } = await import("@/lib/chat-push-poller")
    startChatPushPoller()
  }
}
