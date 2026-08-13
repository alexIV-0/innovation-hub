/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Used to kick off background loops so they're running before any request
 * comes in:
 *
 *   — chat push poller (lib/chat-push-poller.ts) — тянет ответы команды из YouGile;
 *   — pipeline runner (lib/pipeline/runner.ts) — следит за папками IN и создаёт
 *     объекты для обработки, пока слежение включено в админке. Цикл поднимается
 *     всегда, а работает или спит — решает флаг в базе, поэтому включённое
 *     слежение переживает перезапуск процесса.
 *
 * Guarded to the Node runtime since this touches Postgres/web-push, neither
 * of which work in the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startChatPushPoller } = await import("@/lib/chat-push-poller")
    startChatPushPoller()

    const { startPipelineRunner } = await import("@/lib/pipeline/runner")
    startPipelineRunner()
  }
}
