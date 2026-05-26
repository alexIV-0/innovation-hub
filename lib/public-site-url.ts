export function getPublicSiteUrl(): string | null {
  const explicit = process.env.APP_PUBLIC_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`

  return null
}

export function publicVideoPageUrl(videoId: string): string {
  const base = getPublicSiteUrl()
  if (!base) return `/video/${videoId}`
  return `${base}/video/${videoId}`
}
