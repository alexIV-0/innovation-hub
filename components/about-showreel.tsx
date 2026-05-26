"use client"

export function AboutShowreel() {
  return (
    <div className="premium-card relative overflow-hidden rounded-[34px]">
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-background/10 via-transparent to-background/40" />
      <div className="aspect-video overflow-hidden">
        <video
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/icon.svg"
          controls
          controlsList="nodownload"
          onContextMenu={(event) => event.preventDefault()}
        >
          <source src="/promo_video.mp4" type="video/mp4" />
        </video>
      </div>
    </div>
  )
}
