// Minimal service worker: only exists to receive Web Push events and show
// OS notifications for new project chat replies. Not a full offline/PWA
// cache — intentionally does nothing on "install"/"fetch".

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "New message", body: event.data ? event.data.text() : "" }
  }

  const title = data.title || "New message"
  const options = {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: data.url || "/account/projects" },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/account/projects"

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((allClients) => {
        const existing = allClients.find((c) => {
          try {
            return new URL(c.url).pathname === url
          } catch {
            return false
          }
        })
        if (existing) return existing.focus()
        return self.clients.openWindow(url)
      }),
  )
})
