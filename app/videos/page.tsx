import { FooterSection } from "@/components/footer-section"
import { Header } from "@/components/header"
import { VideosBrowser } from "@/components/videos/videos-browser"
import { getPublishedVideos } from "@/lib/public-data"

export const dynamic = "force-dynamic"

type VideosPageProps = {
  searchParams?: Promise<{
    tag?: string | string[]
    tags?: string | string[]
    q?: string | string[]
  }>
}

export default async function VideosPage({ searchParams }: VideosPageProps) {
  const videos = await getPublishedVideos()
  const params = searchParams ? await searchParams : {}
  const rawTag = params?.tag
  const selectedTag = Array.isArray(rawTag) ? rawTag[0] : rawTag
  const rawTags = params?.tags
  const selectedTagsParam = Array.isArray(rawTags) ? rawTags[0] : rawTags
  const selectedTags = selectedTagsParam
    ? selectedTagsParam
        .split(",")
        .map((tag) => decodeURIComponent(tag.trim()))
        .filter(Boolean)
    : selectedTag
      ? [selectedTag]
      : []
  const rawQuery = params?.q
  const selectedQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="section-space border-b border-border/40">
          <div className="section-shell">
            <p className="type-eyebrow">Videos</p>
            <h1 className="type-h1 mt-4 text-foreground">All Ready Showcase Videos</h1>
            <p className="type-body mt-4 max-w-3xl">
              Browse every published showcase video from the admin panel. Currently available:{" "}
              <span className="font-medium text-foreground">{videos.length}</span>.
            </p>
            <VideosBrowser videos={videos} initialTags={selectedTags} initialQuery={selectedQuery} />
          </div>
        </section>
      </main>
      <FooterSection />
    </div>
  )
}
