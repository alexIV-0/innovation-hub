import type { NextResponse } from "next/server"
import type { z } from "zod"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { recordAuditEvent } from "@/lib/repositories/admin-audit"
import { isMachineAuth, type StorageApiAuth } from "@/lib/storage/auth"
import type { vendorKeysSchema, vendorUsageSchema } from "@/lib/vault/schemas"
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
    accounts: props.accounts,
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
    // Платформенных учёток несколько, а метка не названа. Молча выбрать одну
    // значило бы однажды увести боевой прогон на отладочный ключ.
    ambiguous: issue.ambiguous,
    // Адрес, выбранная учётка и наличие ключа по каждому пригодному сервису.
    // Отдельно от `keys`: секрет приходит только при смене версии, а адрес
    // нужен всегда — иначе правка адреса без ротации до машины не доедет.
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
    taskId: props.taskId,
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
