import type { AdminDict } from "@/components/admin/admin-dict"
import type { SkipReason } from "@/lib/pipeline/scan"

/**
 * Подпись к причине, по которой обход не завёл задачу.
 *
 * Полной записью, а не через `` `skip${...}` ``: так TypeScript ловит новую
 * причину в `SkipReason` прямо здесь и не даёт выкатить обход, который скажет
 * «задача не создана» и не объяснит почему.
 *
 * Отдельным файлом, потому что причины показывают двое: закладка «Обход IN» в
 * настройках и кнопка обхода в шапке очереди.
 */
export const SKIP_LABEL: Record<SkipReason, keyof AdminDict> = {
  "no-options": "skipNoOptions",
  "invalid-options": "skipInvalidOptions",
  "no-main-search": "skipNoMainSearch",
  "no-search-type": "skipNoSearchType",
  "unknown-search-type": "skipUnknownSearchType",
  "no-search-exts": "skipNoSearchExts",
  "folder-not-ready": "skipFolderNotReady",
  "empty-folder": "skipEmptyFolder",
  "no-match": "skipNoMatch",
  "already-queued": "skipAlreadyQueued",
  "insufficient-funds": "skipInsufficientFunds",
  "no-pay-unit": "skipNoPayUnit",
  "unsupported-pay-pair": "skipUnsupportedPayPair",
  "pay-unit-mismatch": "skipPayUnitMismatch",
  "no-vendor-account": "skipNoVendorAccount",
}
