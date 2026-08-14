import { readSettings } from "@/lib/repositories/automation-settings"
import { applySettingsWrite } from "@/lib/settings-endpoint"
import { settingsReadSchema, settingsWriteSchema } from "@/lib/settings-schemas"
import { apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"

/**
 * Общие словари на машинном API. Форма запроса и ответа — та же, что у
 * `/api/storage/v1/settings`; см. docs/SETTINGS_SYNC.md §7.
 *
 * Обе поверхности существуют потому, что у них разные токены: десктоп ходит с
 * `mch_…` в storage-API, машины конвейера — с `rc_…` в `POST /api/v1`.
 */

export const getSettingsAction = defineAction(
  settingsReadSchema,
  async (_auth, props) => apiOk(await readSettings(props.domains)),
)

export const putSettingsAction = defineAction(
  settingsWriteSchema,
  async (auth, props) =>
    applySettingsWrite(
      {
        userId: auth.userId,
        role: auth.role,
        isMachine: Boolean(auth.machineTokenId || auth.computerId),
      },
      props,
    ),
)
