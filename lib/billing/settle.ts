import { query, withTransaction } from "@/lib/db"
import { getFunds } from "@/lib/billing/funds"
import { closeGrant } from "@/lib/billing/grants"
import { recordTransaction, splitShortfall } from "@/lib/billing/ledger"
import { minAdmitCents, priceCharge } from "@/lib/billing/pricing"
import { readLatestRate } from "@/lib/billing/rates"
import { rateForPair } from "@/lib/billing/settings"
import { readBillingSettings } from "@/lib/billing/settings"
import {
  breakdownTotal,
  isPayBase,
  isPayMeter,
  payPair,
  type PayBase,
  type PayMeter,
  type Wallet,
} from "@/lib/billing/types"

/**
 * Списание по факту — из строки архива обработок.
 *
 * Почему единственный путь именно этот, а не отчёт машины (`taskDone`):
 * в отчёте есть `totalCost` и список файлов, но нет хронометража результата.
 * Строка архива несёт всё сразу — `outSec`, `renderSec`, `out[]`, `totalCost`,
 * — и связана с задачей сквозным `item_id = tasks.id`. Второй путь дал бы
 * второй источник правды при том же наборе полей минус один.
 *
 * Проход отдельный, а не внутри импорта: упавшее списание не должно мешать
 * импорту, а незавершённое подхватится следующим проходом. Идемпотентность
 * держит уникальный индекс по `task_id`, а не порядок вызовов.
 */

const SETTLE_LIMIT = 200

export type SettleResult = {
  considered: number
  charged: number
  exempt: number
  skipped: number
  errors: number
}

type UnbilledRow = {
  taskId: string
  projectId: string
  ownerId: string
  billingExempt: boolean
  payWallet: Wallet | null
  payGrantId: string | null
  status: string
  outSec: number | null
  renderSec: number | null
  outCount: number
  totalCost: string | null
  payBase: string | null
  payMeter: string | null
  sourceUnits: string | null
}

/**
 * Обработки, по которым ещё не списано.
 *
 * `item_id = tasks.id` работает только для задач, созданных после появления
 * сквозного идентификатора (docs/PIPELINE.md §15). Более старые сюда не попадут
 * никогда — и это правильно: связать их с задачей можно было бы только
 * гаданием, а гадать деньгами нельзя.
 */
async function listUnbilled(limit: number): Promise<UnbilledRow[]> {
  const result = await query<UnbilledRow>(
    `SELECT t.id                     AS "taskId",
            t.project_id             AS "projectId",
            p.user_id                AS "ownerId",
            COALESCE(u.billing_exempt, FALSE) AS "billingExempt",
            t.pay_wallet             AS "payWallet",
            t.pay_grant_id           AS "payGrantId",
            ps.status,
            ps.out_sec               AS "outSec",
            ps.render_sec            AS "renderSec",
            COALESCE(jsonb_array_length(ps.out_paths), 0) AS "outCount",
            ps.total_cost::text      AS "totalCost",
            t.payload #>> '{description,payBase}'  AS "payBase",
            t.payload #>> '{description,payMeter}' AS "payMeter",
            t.payload #>> '{description,sourceUnits}' AS "sourceUnits"
       FROM processing_stats ps
       JOIN tasks t    ON t.id = ps.item_id
       JOIN projects p ON p.id = t.project_id
       JOIN users u    ON u.id = p.user_id
      WHERE NOT EXISTS (
              SELECT 1 FROM billing_transactions b
               WHERE b.task_id = t.id AND b.kind IN ('charge', 'exempt')
            )
      ORDER BY ps.ended_at ASC NULLS LAST
      LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Количество единиц по факту.
 *
 * `source × sec` здесь отсутствует намеренно: `srcSec` — поле схемы v2, и пока
 * машина его не шлёт, такая пара до списания не доходит (её отсекает белый
 * список в lib/billing/pay-unit.ts).
 */
function unitsFor(row: UnbilledRow, base: PayBase, meter: PayMeter | null): number | null {
  if (base === "fixed") return 1
  if (base === "output" && meter === "sec") return row.outSec ?? null
  if (base === "output" && meter === "count") return row.outCount
  if (base === "render" && meter === "sec") return row.renderSec ?? null
  if (base === "source") {
    // Количество исходников сборка задачи посчитала заранее и положила в
    // description: после обработки папки в каталоге уже может не быть тех
    // файлов (их переносит postProcess), и пересчитать её задним числом нечем.
    const raw = row.sourceUnits == null ? null : Number(row.sourceUnits)
    return raw != null && Number.isFinite(raw) ? raw : null
  }
  return null
}

export async function settleUnbilled(limit = SETTLE_LIMIT): Promise<SettleResult> {
  const out: SettleResult = {
    considered: 0,
    charged: 0,
    exempt: 0,
    skipped: 0,
    errors: 0,
  }

  const rows = await listUnbilled(limit)
  if (rows.length === 0) return out
  out.considered = rows.length

  const { settings } = await readBillingSettings()
  const vendorRate = await readLatestRate(settings.vendorCurrency)

  for (const row of rows) {
    try {
      // Упавшая обработка не тарифицируется — то же правило, что в архиве.
      // Резерв с неё снялся статусом задачи, отпускать нечего.
      if (row.status !== "done") {
        out.skipped++
        continue
      }
      if (!isPayBase(row.payBase)) {
        // Оси не разрешились на сборке. Гейт денег их отсечёт раньше, чем сюда
        // дойдёт; пока он выключен — обработка бесплатна и видна в unpriced.
        out.skipped++
        continue
      }
      const base = row.payBase
      const meter = base === "fixed" ? null : isPayMeter(row.payMeter) ? row.payMeter : null
      if (base !== "fixed" && meter == null) {
        out.skipped++
        continue
      }

      const units = unitsFor(row, base, meter)
      if (units == null) {
        out.skipped++
        continue
      }

      const pair = payPair(base, meter)
      const unitRateCents = rateForPair(settings, pair)
      if (unitRateCents == null) {
        // Ставки нет — это не «бесплатно», а «не назначено». Молча списать ноль
        // значило бы сделать забытую ставку осознанным решением.
        out.skipped++
        continue
      }

      const priced = priceCharge({
        base,
        meter,
        units,
        unitRateCents,
        marginPct: settings.marginPct,
        vendorAmount: row.totalCost == null ? null : Number(row.totalCost),
        vendorCurrency: settings.vendorCurrency,
        vendorRate: vendorRate?.rate ?? null,
        vendorRateSource: vendorRate?.source ?? null,
        fxAdjustPct: settings.fxAdjustPct,
      })

      const total = breakdownTotal(priced.breakdown)

      // Освобождённый от оплаты: сумма считается полностью, движения нет.
      // Освобождение от ОПЛАТЫ не освобождает от УЧЁТА — работа админа тратит
      // те же деньги на внешних сервисах, и без этой строки отчёт занижал бы
      // расход ровно на нашу собственную работу.
      if (row.billingExempt) {
        await recordTransaction({
          userId: row.ownerId,
          projectId: row.projectId,
          taskId: row.taskId,
          wallet: row.payWallet ?? "own",
          grantId: row.payGrantId,
          kind: "exempt",
          amountCents: 0,
          breakdown: priced.breakdown,
          terms: priced.terms,
          comment: "Работа без оплаты",
        })
        out.exempt++
        continue
      }

      const wallet: Wallet = row.payWallet ?? "own"

      // Подарочный ниже нуля не уходит: сколько осталось — столько и платит,
      // разницу пишем себе. Свой уходит в минус — там это долг, а не убыток,
      // и закроется первым пополнением.
      let covered = total
      if (wallet === "gift") {
        const funds = await getFunds(row.ownerId)
        const grant = funds.grants.find((g) => g.grantId === row.payGrantId)
        const remaining = grant?.remainingCents ?? funds.balances.gift
        covered = Math.max(0, Math.min(total, remaining))
      }

      const { paid, absorbed } = splitShortfall(priced.breakdown, covered)

      await withTransaction(async (client) => {
        await recordTransaction(
          {
            userId: row.ownerId,
            projectId: row.projectId,
            taskId: row.taskId,
            wallet,
            grantId: row.payGrantId,
            kind: "charge",
            amountCents: -covered,
            breakdown: paid,
            terms: priced.terms,
          },
          client,
        )

        if (breakdownTotal(absorbed) > 0) {
          await recordTransaction(
            {
              userId: row.ownerId,
              projectId: row.projectId,
              // task_id здесь есть: уникальный индекс ограничивает только
              // charge и exempt, а writeoff — вторая строка по той же работе, и
              // без ссылки на задачу её пришлось бы искать по времени.
              taskId: row.taskId,
              wallet,
              grantId: row.payGrantId,
              kind: "writeoff",
              amountCents: 0,
              breakdown: absorbed,
              terms: priced.terms,
              comment: "Не покрыто кошельком",
            },
            client,
          )
        }
      })

      out.charged++

      // Хвост подарка. Остатка не хватает даже на минимальный кусок работы —
      // формально грант не исчерпан, фактически на него ничего не купить, и в
      // кабинете он повиснет непонятной строкой. Проверяем здесь, потому что
      // ставка и мера уже в руках: в другом месте их пришлось бы добывать
      // заново, а без них порог «10 секунд» не перевести в деньги.
      if (wallet === "gift" && row.payGrantId) {
        const after = await getFunds(row.ownerId)
        const grant = after.grants.find((g) => g.grantId === row.payGrantId)
        if (grant) {
          const threshold = minAdmitCents({
            minUnits: settings.minAdmitUnits[meter ?? "sec"],
            unitRateCents: unitRateCents,
          })
          if (grant.remainingCents < threshold) {
            await closeGrant({
              grantId: grant.grantId,
              status: "exhausted",
              remainingCents: Math.max(0, grant.remainingCents),
              comment: "Остатка не хватает на минимальную обработку",
            })
          }
        }
      }
    } catch (error) {
      out.errors++
      console.error("[billing] списание не прошло", row.taskId, error)
    }
  }

  return out
}

/**
 * Закрыть подарки, у которых вышел срок.
 *
 * Отдельно от списания: срок истекает по календарю, а не по факту обработки, и
 * ждать чужого прогона, чтобы погасить остаток, неправильно. Остаток гасится
 * строкой — молча стёртые деньги были бы дырой в ленте.
 */
export async function closeExpiredGrants(): Promise<number> {
  const result = await query<{ grantId: string; remaining: string }>(
    `SELECT g.id AS "grantId",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text AS remaining
       FROM billing_grants g
      WHERE g.status = 'active'
        AND g.expires_at IS NOT NULL
        AND g.expires_at <= NOW()`,
  )

  for (const row of result.rows) {
    await closeGrant({
      grantId: row.grantId,
      status: "expired",
      remainingCents: Math.max(0, Number(row.remaining)),
      comment: "Срок подарка истёк",
    })
  }
  return result.rows.length
}
