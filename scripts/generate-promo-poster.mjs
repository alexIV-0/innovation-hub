// One-off helper: captures a frame of public/promo_video.mp4 with the
// system Chrome and saves it as public/promo_poster.jpg, used as the
// <video poster> so the landing LCP is a small image instead of a frame
// of the ~95MB video. Re-run after replacing the promo video:
//   node scripts/generate-promo-poster.mjs
import { chromium } from "playwright-core"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// Served over HTTP (dev/prod server must be running) — Chrome refuses to
// load file:// media from a scripted page.
const videoUrl = "http://localhost:3000/promo_video.mp4"
const posterPath = path.join(root, "public", "promo_poster.jpg")

const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  })
  await page.setContent(
    `<body style="margin:0;background:#000">
       <video id="v" src="${videoUrl}" muted playsinline
              style="width:1280px;height:720px;object-fit:cover;display:block"></video>
     </body>`,
  )
  await page.evaluate(async () => {
    const v = document.getElementById("v")
    await new Promise((resolve, reject) => {
      v.addEventListener("loadeddata", resolve, { once: true })
      v.addEventListener("error", () => reject(new Error("video error")), {
        once: true,
      })
      v.load()
    })
    v.currentTime = 2
    await new Promise((resolve) =>
      v.addEventListener("seeked", resolve, { once: true }),
    )
  })
  await page
    .locator("#v")
    .screenshot({ path: posterPath, type: "jpeg", quality: 78 })
  console.log("Poster written to", posterPath)
} finally {
  await browser.close()
}
