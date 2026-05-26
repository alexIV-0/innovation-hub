import { redirect } from "next/navigation"

type VideosPageProps = {
  searchParams?: Promise<{
    tag?: string | string[]
    tags?: string | string[]
    q?: string | string[]
  }>
}

export default async function VideosPage({ searchParams }: VideosPageProps) {
  const params = searchParams ? await searchParams : {}
  const forward = new URLSearchParams()

  const rawTags = params?.tags
  const rawTag = params?.tag
  const tagsParam = Array.isArray(rawTags) ? rawTags[0] : rawTags
  const tagParam = Array.isArray(rawTag) ? rawTag[0] : rawTag
  if (tagsParam) forward.set("tags", tagsParam)
  else if (tagParam) forward.set("tags", tagParam)

  const rawQuery = params?.q
  const query = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery
  if (query) forward.set("q", query)

  const qs = forward.toString()
  redirect(qs ? `/?${qs}` : "/")
}
