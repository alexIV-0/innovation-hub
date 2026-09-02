import type { NextResponse } from "next/server"
import type { z } from "zod"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { recordAuditEvent } from "@/lib/repositories/admin-audit"
import { query } from "@/lib/db"
import { setPausedReason } from "@/lib/billing/admission"
import { blockTaskOnVendorKey } from "@/lib/pipeline/queue"
import { setProjectPaused } from "@/lib/project-automation"
import { isMachineAuth, type StorageApiAuth } from "@/lib/storage/auth"
import { BLOCKING_INCIDENT_CODES, type IncidentCode } from "@/lib/vault/types"
import type {
  vendorIncidentSchema,
  vendorKeysSchema,
  vendorUsageSchema,
} from "@/lib/vault/schemas"
import { findTaskOwner, issueKeysForMachine } from "@/lib/vault/services"
import { recordUsage } from "@/lib/vault/usage"

/**
 * Сейф для машин: выдача ключей и приём потребления.
 *
 * Логика здесь, а обёртки тонкие — тот же приём, что у очереди и общих
 * словарей, и по той же причине: **у поверхностей разные токены**. Машины парка
 * ходят с `rc_…` на `POST /api/v1`, десктоп — с `mch_…` на
 * `/api/storage/v1/*`. Реализуй мы сейф только на одной, вторая половина парка
 * осталась бы без ключей, а обнаружилось бы это на первой обработке.
 *
 * Порядок работы ноды (innovation-hub/docs/VENDOR_SERVICES_PLAN.md, С4):
 *
 *   1. перед задачей — ключи со своими версиями;
 *   2. ответ «актуально» → берём из локального сейфа, ничего не качаем;
 *   3. вызов вендора СВОИМ ключом, без участия сайта;
 *   4. сразу после ответа вендора — потребление в ЕДИНИЦАХ, не в деньгах.
 *
 * Четвёртый шаг делается сразу, а не в `taskDone`: вендор уже получил свои
 * деньги, и упади машина следом — расход всё равно должен быть учтён.
 */

export async function handleVendorKeys(
  auth: StorageApiAuth,
  props: z.infer<typeof vendorKeysSchema>,
): Promise<NextResponse> {
  // Ключи выдаются только машине. Обе поверхности машинные, но проверка стоит
  // здесь, а не в документации: появись третий вход с сессией браузера — он
  // молча начал бы раздавать секреты.
  if (!isMachineAuth(auth)) {
    return apiError("Vendor keys are issued to machines only.", 403)
  }

  // Владельца задачи разрешает САЙТ, а не машина: проект пользователя А на
  // воркере парка должен работать ключом А. У машины выбирать не из чего — по
  // правилу «выдаём только нужное» чужих учёток на ней лежать не должно.
  const ownerUserId = props.taskId ? await findTaskOwner(props.taskId) : null

  const issue = await issueKeysForMachine({
    slugs: props.services,
    known: props.known ?? {},
    ownerUserId,
  })

  // В журнал пишем только НАСТОЯЩУЮ выдачу. Подтверждение «версия у тебя
  // актуальная» секрета не раскрывает, и записывать его значило бы утопить саму
  // выдачу в потоке обычных проверок перед задачей.
  if (issue.issued.length > 0) {
    await recordAuditEvent({
      actorId: auth.userId,
      actorEmail: auth.email,
      action: "service.keys_issued",
      targetType: "computer",
      targetId: auth.computerId,
      meta: {
        // Учётка в записи обязательна: «выдали ключ ElevenLabs» без неё не
        // отвечает на вопрос, чей ключ уехал — наш или клиентский.
        services: issue.issued.map(
          (key) => `${key.slug}/${key.account}@${key.version}`,
        ),
        // Чем машина опозналась: у `rc_…` есть компьютер, у `mch_…` — только
        // токен. Без этого в журнале осталась бы выдача без адресата.
        machineTokenId: auth.machineTokenId,
      },
    })
  }

  return apiOk({
    keys: issue.issued,
    fresh: issue.fresh,
    unavailable: issue.unavailable,
    // Адрес, доступные учётки и состав полей по каждому пригодному сервису.
    // Отдельно от `keys`: секрет приходит только при смене версии, а адрес и
    // список учёток нужны всегда — иначе правка адреса без ротации до машины
    // не доедет, а выбрать ключ в настройках проекта будет не из чего.
    services: issue.services,
    vaultRevision: issue.revision,
  })
}

export async function handleVendorUsage(
  auth: StorageApiAuth,
  props: z.infer<typeof vendorUsageSchema>,
): Promise<NextResponse> {
  if (!isMachineAuth(auth)) {
    return apiError("Usage is reported by machines only.", 403)
  }

  const result = await recordUsage({
    // `null` — локальный прогон. Схема уже проверила, что тогда есть `runId`:
    // без него повторный отчёт лёг бы второй строкой и удвоил расход.
    taskId: props.taskId ?? null,
    runId: props.runId ?? null,
    projectId: props.projectId ?? null,
    computerId: auth.computerId,
    entries: props.entries.map((entry) => ({
      serviceSlug: entry.service,
      unit: entry.unit,
      units: entry.units,
      account: entry.account ?? null,
    })),
  })

  // Отвечаем разбором, а не «ок»: `unpriced` и `noRate` означают, что расход НЕ
  // записан, и машина должна знать об этом, чтобы повторить позже. Молчаливое
  // «принято» превратило бы потерянную себестоимость в невидимую.
  return apiOk(result)
}

/**
 * Погасить проект, которому не хватает ключа.
 *
 * Владельца и `storage_owner_id` берём из базы, а не из запроса: машина о них
 * знать не обязана, а пауза пишется в два места сразу — колонку и сайдкар
 * `options/folderState.json`, — и промахнуться ключом сайдкара нельзя.
 *
 * `false` — проект не нашёлся либо уже стоял на паузе по этой же причине:
 * повторный инцидент по той же поломке не должен переписывать состояние.
 */
async function pauseProjectForVendorKey(input: {
  projectId: string
  reason: IncidentCode
  service: string
}): Promise<boolean> {
  const found = await query<{
    ownerId: string
    storageOwnerId: string
    pausedReason: string | null
  }>(
    `SELECT user_id AS "ownerId",
            COALESCE(storage_owner_id, user_id) AS "storageOwnerId",
            paused_reason AS "pausedReason"
       FROM projects WHERE id = $1`,
    [input.projectId],
  )
  const project = found.rows[0]
  if (!project) return false
  if (project.pausedReason === "no-vendor-key") return false

  try {
    await setProjectPaused({
      projectId: input.projectId,
      ownerId: project.ownerId,
      storageOwnerId: project.storageOwnerId,
      paused: true,
      updatedBy: "vault",
    })
    await setPausedReason(input.projectId, "no-vendor-key")
    return true
  } catch (error) {
    // Не сумели погасить — инцидент всё равно записан, и это главное. Ронять
    // ответ машине незачем: она уже сделала свою часть.
    console.error("[vault] пауза по ключу не записалась", input.projectId, error)
    return false
  }
}

/**
 * Инцидент в контуре ключей, замеченный машиной (пункт 8 запроса клиента).
 *
 * Две вещи сразу, и обе обязательны:
 *
 * 1. **запись в журнал.** Ошибки этого контура возникают на машине, и не попади
 *    они сюда, половина картины осталась бы в логах машин, а треугольник на
 *    карточке проекта знал бы только то, что заметили мы;
 * 2. **пауза проекта** — но не на всякий код. `key-missing`, `key-rejected` и
 *    `owner-out-of-funds` означают, что другие машины тоже не справятся, и
 *    гонять задачу по парку до `maxAttempts` бессмысленно. `vendor-refused` и
 *    `quota-exceeded` так не гасят: первое бывает разовым сбоем вендора, второе
 *    проходит само со сменой суток.
 */
export async function handleVendorIncident(
  auth: StorageApiAuth,
  props: z.infer<typeof vendorIncidentSchema>,
): Promise<NextResponse> {
  if (!isMachineAuth(auth)) {
    return apiError("Incidents are reported by machines only.", 403)
  }

  await recordAuditEvent({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "service.incident",
    targetType: props.projectId ? "project" : "service",
    targetId: props.projectId ?? props.service,
    targetLabel: props.service,
    meta: {
      code: props.code,
      service: props.service,
      account: props.account ?? null,
      taskId: props.taskId ?? null,
      projectId: props.projectId ?? null,
      detail: props.detail ?? null,
      computerId: auth.computerId,
    },
  })

  const blocking = BLOCKING_INCIDENT_CODES.includes(props.code)
  let paused = false
  let taskClosed = false

  if (blocking) {
    // Задачу закрываем ПЕРВОЙ: она держит аренду, и пока держит — её никто не
    // подхватит, а пауза проекта уже ни на что не влияет.
    if (props.taskId && auth.computerId) {
      const result = await blockTaskOnVendorKey({
        computerId: auth.computerId,
        taskId: props.taskId,
        code: props.code,
        service: props.service,
      })
      taskClosed = result.ok
    }
    if (props.projectId) {
      paused = await pauseProjectForVendorKey({
        projectId: props.projectId,
        reason: props.code,
        service: props.service,
      })
    }
  }

  // Отвечаем разбором, а не «ок». Машине надо знать три вещи: записали ли
  // (записали всегда), считаем ли код блокирующим и что с задачей — иначе она
  // не поймёт, ждать ли ей повтора по этой же задаче.
  return apiOk({ recorded: true, blocking, taskClosed, paused })
}
