import { defineAction } from "@/lib/machine-api/types"
import { handleVendorKeys, handleVendorUsage } from "@/lib/vault/endpoint"
import { vendorKeysSchema, vendorUsageSchema } from "@/lib/vault/schemas"

/**
 * Сейф на машинном API. Логика — в lib/vault/endpoint.ts, здесь только привязка
 * схем к экшенам: тот же контракт доступен и под `/api/storage/v1/vault`,
 * которым ходит десктоп со своим `mch_…`.
 */

export const vendorKeysAction = defineAction(vendorKeysSchema, handleVendorKeys)
export const vendorUsageAction = defineAction(vendorUsageSchema, handleVendorUsage)
