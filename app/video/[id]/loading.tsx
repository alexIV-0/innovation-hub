import { Skeleton } from "@/components/ui/skeleton"

export default function VideoDetailLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-border/40 bg-card/30">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-6 w-64 max-w-full" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <div className="mt-8 space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-sm" />
            <Skeleton className="h-6 w-20 rounded-sm" />
          </div>
          <Skeleton className="h-8 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-3xl" />
          <Skeleton className="h-4 w-2/3 max-w-2xl" />
        </div>
        <div className="my-12 h-px bg-border" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
