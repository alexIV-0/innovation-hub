import { query } from "@/lib/db"

/**
 * Очередь задач для окна «Очередь» на странице конвейера.
 *
 * Показывает три вещи, которые админ хочет видеть, не открывая базу: что нашлось,
 * какая машина взяла задачу и в каком та сейчас состоянии.
 */

export type TaskStatus = "queued" | "claimed" | "running" | "done" | "failed"

export type PipelineTask = {
  id: string
  status: TaskStatus
  projectId: string
  projectName: string
  ownerEmail: string
  /** Имя файла, по которому создана задача. */
  sourceName: string
  /** Сколько шагов в собранной цепочке обработки. */
  stepCount: number
  /** Машина, взявшая задачу; null — ещё никто не взял. */
  machineName: string | null
  claimedAt: string | null
  leaseExpiresAt: string | null
  attempts: number
  error: string | null
  createdAt: string
}

type TaskRow = Omit<
  PipelineTask,
  "claimedAt" | "leaseExpiresAt" | "createdAt"
> & {
  claimedAt: Date | null
  leaseExpiresAt: Date | null
  createdAt: Date
}

export async function listPipelineTasks(limit = 200): Promise<PipelineTask[]> {
  const result = await query<TaskRow>(
    `SELECT t.id,
            t.status,
            t.project_id AS "projectId",
            p.name       AS "projectName",
            u.email      AS "ownerEmail",
            -- Имя файла лежит в собранном объекте; ключ как запас на случай,
            -- когда description ещё не заполнен.
            COALESCE(
              t.payload -> 'description' ->> 'curItem',
              regexp_replace(t.source_key, '^.*/', '')
            ) AS "sourceName",
            COALESCE(jsonb_array_length(t.payload -> 'processingQueue'), 0) AS "stepCount",
            c.name       AS "machineName",
            t.claimed_at AS "claimedAt",
            t.lease_expires_at AS "leaseExpiresAt",
            t.attempts,
            t.error,
            t.created_at AS "createdAt"
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN remote_computers c ON c.id = t.claimed_by
      ORDER BY
        -- Живые задачи выше завершённых: в работе интересует то, что происходит.
        CASE t.status
          WHEN 'running' THEN 0
          WHEN 'claimed' THEN 1
          WHEN 'queued'  THEN 2
          WHEN 'failed'  THEN 3
          ELSE 4
        END,
        t.created_at DESC
      LIMIT $1`,
    [limit],
  )

  return result.rows.map((r) => ({
    ...r,
    claimedAt: r.claimedAt?.toISOString() ?? null,
    leaseExpiresAt: r.leaseExpiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export type TaskCounts = Record<TaskStatus, number> & { total: number }

export async function countPipelineTasksByStatus(): Promise<TaskCounts> {
  const result = await query<{ status: TaskStatus; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status`,
  )
  const counts: TaskCounts = {
    queued: 0,
    claimed: 0,
    running: 0,
    done: 0,
    failed: 0,
    total: 0,
  }
  for (const row of result.rows) {
    counts[row.status] = row.n
    counts.total += row.n
  }
  return counts
}
