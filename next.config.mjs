/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // VideoCard backdrop uses quality={30}; default allow-list is only [75].
    qualities: [30, 70, 75],
    localPatterns: [
      // Thumbnails proxied through the media route in raw-stream mode.
      { pathname: "/api/media/**", search: "?raw=1" },
      // Static assets from /public (no query strings).
      { pathname: "/**", search: "" },
    ],
    // Thumbnails are referenced via same-origin /api/media/... paths, but
    // allow the configured CDN / R2 host too in case absolute URLs are ever stored.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.ffworks.pro",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
      // Legacy Timeweb URLs may still exist in older DB rows.
      {
        protocol: "https",
        hostname: "s3.twcstorage.ru",
      },
    ],
    // /api/media redirects to short-lived presigned S3 URLs; a long
    // optimizer cache keeps repeat visits from re-fetching the originals.
    minimumCacheTTL: 60 * 60 * 24,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "260mb",
    },
    // Rewrites barrel imports to per-module ones so only the icons/pieces
    // actually used end up in each chunk.
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
}

export default nextConfig
