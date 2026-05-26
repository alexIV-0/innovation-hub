/** Normalize tag strings for storage and comparison. */
export function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

/** Deduplicate tags case-insensitively while preserving first-seen casing. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

/** Primary tag for legacy `category` consumers. */
export function primaryTag(tags: string[]): string {
  return tags[0] ?? ""
}
