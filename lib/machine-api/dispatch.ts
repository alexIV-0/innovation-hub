import { authenticateComputerToken } from "@/lib/storage/auth"
import { apiError } from "@/lib/machine-api/http"
import { ACTION_REGISTRY } from "@/lib/machine-api/registry"

/**
 * Machine API pipeline:
 * 1. Auth (token)
 * 2. Props valid (known action + schema)
 * 3. Execute
 */
export async function dispatchMachineApi(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError("Request body must be a JSON object.", 400)
  }

  const rec = body as Record<string, unknown>

  const token = rec.token
  if (typeof token !== "string" || !token.trim()) {
    return apiError("Unauthorized.", 401)
  }

  const auth = await authenticateComputerToken(token)
  if (!auth) {
    return apiError("Invalid computer token.", 401)
  }

  const action = rec.action
  if (typeof action !== "string" || !action.trim()) {
    return apiError("action is required.", 400)
  }

  const handler = ACTION_REGISTRY[action]
  if (!handler) {
    return apiError(`Unknown action: ${action}.`, 400)
  }

  if (
    rec.props !== undefined &&
    (typeof rec.props !== "object" || rec.props === null || Array.isArray(rec.props))
  ) {
    return apiError("props must be an object.", 400)
  }

  const parsed = handler.schema.safeParse(rec.props ?? {})
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid props.", 400)
  }

  return handler.run(auth, parsed.data)
}
