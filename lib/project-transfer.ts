import { query, withTransaction } from "@/lib/db"
import { findOpenGrantForProject } from "@/lib/billing/grants"
import type { ProjectRecord, UserRecord } from "@/lib/domain-types"
import { setProjectPaused } from "@/lib/project-automation"
import { findProjectById } from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"
import { syncProjectMeta } from "@/lib/storage/project-catalog"

/**
 * Передача проекта другому человеку.
 *
 * Меняется ОДНО поле — `projects.user_id`. Байты не двигаются: их адрес живёт в
 * `storage_owner_id` и неизменен (docs/ADMIN_WORKSPACE_PLAN.md §5). Отсюда и
 * скорость: перенос — это запрос, а не фоновая работа на минуты.
 *
 * Зачем это вообще нужно: тарификация считает владельца — `p.user_id` в
 * `listUnbilled` (lib/billing/settle.ts) и гейт владельца в
 * `listWatchedProjects`. Расшаривание кошелька не двигает, поэтому «свести
 * оплату в одно место, не отбирая доступ» = передать проект и расшарить его
 * обратно прежнему владельцу.
 */
export type TransferRefusal =
  | "not-found"
  | "same-owner"
  | "target-not-found"
  | "target-inactive"
  | "granted"

export type TransferResult =
  | { ok: true; project: ProjectRecord; from: UserRecord | null; to: UserRecord }
  | { ok: false; reason: TransferRefusal }

export async function transferProject(input: {
  projectId: string
  toUserId: string
}): Promise<TransferResult> {
  const project = await findProjectById(input.projectId)
  if (!project || project.deletedAt) return { ok: false, reason: "not-found" }
  if (project.userId === input.toUserId) {
    return { ok: false, reason: "same-owner" }
  }

  const to = await findUserById(input.toUserId)
  if (!to) return { ok: false, reason: "target-not-found" }
  // Заблокированному аккаунту передавать нечего: он не войдёт, а обработка по
  // его проектам не пойдёт. Такой перенос — потерянная папка, а не решение.
  if (!to.isActive) return { ok: false, reason: "target-inactive" }

  // Проект на подарочных деньгах остаётся у того, кому подарок выдан. Иначе
  // вместе с папкой новому владельцу уехал бы чужой остаток, а прежний остался
  // бы с подарком, которым негде платить.
  if (await findOpenGrantForProject(project.id)) {
    return { ok: false, reason: "granted" }
  }

  const from = await findUserById(project.userId)

  const moved = await withTransaction(async (client) => {
    await client.query(
      `UPDATE projects
          SET user_id = $2,
              -- Клиент — группировка внутри кабинета прежнего владельца
              -- (clients.user_id), и у нового его строки нет. Оставить ссылку
              -- значило бы показать ему папку в чужой группе.
              client_id = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [project.id, input.toUserId],
    )
    // Новый владелец не может быть ещё и участником: иначе на вопрос «чей это
    // проект» появятся два ответа — строка в проекте и строка в участниках.
    await client.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [project.id, input.toUserId],
    )
    return true
  })
  if (!moved) return { ok: false, reason: "not-found" }

  const updated = await findProjectById(project.id)
  if (!updated) return { ok: false, reason: "not-found" }

  /**
   * Приехал на паузе — как и копии тестового периода, и по той же причине с
   * другой стороны: гейт обработки у нового владельца может быть включён, и
   * конвейер взял бы проект в работу в ту же минуту, выставив счёт человеку,
   * который ещё не знает, что папка у него. Включает её он сам.
   */
  const paused = await setProjectPaused({
    projectId: updated.id,
    ownerId: updated.ownerId,
    storageOwnerId: updated.storageOwnerId,
    paused: true,
    updatedBy: "transfer",
  }).catch((error) => {
    // Владение уже сменилось — это главное и это состоялось. Не поставили на
    // паузу: сообщаем наверх логом, а не откатом, потому что откат вернул бы
    // проект прежнему владельцу уже после того, как новый его увидел.
    console.error("[transfer] pause after transfer failed", error)
    return null
  })

  const result = paused?.project ?? updated
  await syncProjectMeta(result)

  return { ok: true, project: result, from, to }
}

/** Сколько людей потеряют проект из вида, если его передать. Для подтверждения. */
export async function countProjectMembers(projectId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM project_members WHERE project_id = $1`,
    [projectId],
  )
  return result.rows[0]?.count ?? 0
}
