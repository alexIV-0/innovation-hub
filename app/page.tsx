import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { AboutShowreel } from "@/components/about-showreel"
import { VideoGridInfinite } from "@/components/videos/video-grid-infinite"
import { getCurrentUser } from "@/lib/admin-auth"
import type { VideoCardItem } from "@/lib/content-types"
import { listPublishedVideosPaginated } from "@/lib/repositories/videos"
import { PUBLISHED_VIDEOS_PAGE_SIZE } from "@/lib/videos-pagination"

export const dynamic = "force-dynamic"

type HomePageProps = {
  searchParams?: Promise<{
    tags?: string | string[]
    tag?: string | string[]
    q?: string | string[]
  }>
}

function mapToCard(video: {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  category: string
}): VideoCardItem {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    videoUrl: video.videoUrl,
    duration: video.duration,
    tags: video.tags,
    category: video.category,
  }
}

export default async function Home({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {}
  const rawTags = params?.tags
  const rawTag = params?.tag
  const selectedTagsParam = Array.isArray(rawTags) ? rawTags[0] : rawTags
  const selectedTag = Array.isArray(rawTag) ? rawTag[0] : rawTag
  const selectedTags = selectedTagsParam
    ? selectedTagsParam
        .split(",")
        .map((tag) => decodeURIComponent(tag.trim()))
        .filter(Boolean)
    : selectedTag
      ? [decodeURIComponent(selectedTag.trim())].filter(Boolean)
      : []
  const rawQuery = params?.q
  const selectedQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery ?? ""

  const [{ items, nextCursor }, user] = await Promise.all([
    listPublishedVideosPaginated({
      limit: PUBLISHED_VIDEOS_PAGE_SIZE,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      q: selectedQuery || undefined,
    }),
    getCurrentUser().catch(() => null),
  ])

  const initialVideos = items.map(mapToCard)

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="section-shell section-space pb-0">
          <AboutShowreel />
          {/* TODO(Vanya): add intro copy here */}
        </div>
        <VideoGridInfinite
          initialVideos={initialVideos}
          initialNextCursor={nextCursor}
          initialTags={selectedTags}
          initialQuery={selectedQuery}
          isAdmin={Boolean(user?.isActive && user.role === "ADMIN")}
        />
      </main>
      <FooterSection />
    </div>
  )
}
