import { query } from "@/lib/db"
import { createGrant, findTrialGrant } from "@/lib/billing/grants"
import { listTemplateProjects } from "@/lib/billing/projects"
import { readBillingSettings } from "@/lib/billing/settings"
import { createJob } from "@/lib/storage/jobs"
import { scheduleJob } from "@/lib/storage/job-runner"
import type { GrantRecord } from "@/lib/billing/types"

/**
 * Тестовый период: подарок на баланс и копии подготовленных проектов.
 *
 * Не отдельная подсистема со своей арифметикой, а первый потребитель биллинга:
 * те же оценки, тот же резерв, те же списания, та же остановка при нуле.
 * Отличается ровно двумя вещами — деньги подарочные и тратятся только в
 * скопированных проектах.
 *
 * Период НЕ включается сам при регистрации: кнопка доносит намерение, а
 * активирует человек. Иначе копии шаблонов заняли бы место у каждого, кто
 * зарегистрировался и ушёл.
 */

export type TrialState =
  | { status: "unavailable"; reason: "disabled" | "no-templates" }
  | { status: "available"; amountCents: number; lifetimeDays: number | null }
  | {
      status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
      grant: GrantRecord
      projectIds: string[]
    }

export async function readTrialState(userId: string): Promise<TrialState> {
  const existing = await findTrialGrant(userId)
  if (existing) {
    const projects = await query<{ projectId: string }>(
      `SELECT project_id AS "projectId"
         FROM billing_grant_projects WHERE grant_id = $1`,
      [existing.id],
    )
    return {
      status: existing.status,
      grant: existing,
      projectIds: projects.rows.map((r) => r.projectId),
    }
  }

  const { settings } = await readBillingSettings()
  if (!settings.trial.enabled) {
    return { status: "unavailable", reason: "disabled" }
  }
  const templates = await listTemplateProjects()
  if (templates.length === 0) {
    // Кнопка без шаблонов выдала бы подарок и пустой кабинет — обещание, за
    // которым ничего нет.
    return { status: "unavailable", reason: "no-templates" }
  }
  return {
    status: "available",
    amountCents: settings.trial.amountCents,
    lifetimeDays: settings.trial.lifetimeDays,
  }
}

export type ActivateResult =
  | { ok: true; grant: GrantRecord; jobId: string }
  | { ok: false; reason: "disabled" | "no-templates" | "already-used" }

/**
 * Выдать тестовый период.
 *
 * Порядок важен: сначала строка гранта (её уникальность и есть правило «один
 * раз»), потом работа копирования. Наоборот — и повторное нажатие успело бы
 * поставить вторую работу, пока первая ещё не дошла до вставки гранта.
 */
export async function activateTrial(userId: string): Promise<ActivateResult> {
  const { settings } = await readBillingSettings()
  if (!settings.trial.enabled) return { ok: false, reason: "disabled" }

  const templates = await listTemplateProjects()
  if (templates.length === 0) return { ok: false, reason: "no-templates" }

  const grant = await createGrant({
    userId,
    kind: "trial",
    amountCents: settings.trial.amountCents,
    lifetimeDays: settings.trial.lifetimeDays,
    comment: "Тестовый период",
    // Деньги начислятся, когда копии доедут: до тех пор тратить их негде.
    activateNow: false,
  })
  if (!grant) return { ok: false, reason: "already-used" }

  const job = await createJob({
    userId,
    projectId: null,
    kind: "trial-provision",
    total: templates.length,
    payload: {
      grantId: grant.id,
      templateIds: templates.map((t) => t.projectId),
    },
    // Работа привязана к гранту: повторный вызов на том же гранте не заведёт
    // вторую копию набора.
    eventId: `trial-provision:${grant.id}`,
  })

  await query(`UPDATE billing_grants SET provision_job_id = $2 WHERE id = $1`, [
    grant.id,
    job.id,
  ])

  scheduleJob(job.id)
  return { ok: true, grant, jobId: job.id }
}
