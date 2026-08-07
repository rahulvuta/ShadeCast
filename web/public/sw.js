/* ShadeCast offline cache — last successful assess JSON + app shell. */
const CACHE = 'shadecast-shell-v1'
const ASSESS_KEY = 'shadecast-last-assess'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return

  // Cache successful assess responses for offline replay
  if (url.pathname.startsWith('/api/assess')) {
    event.respondWith(
      fetch(event.request)
        .then(async (res) => {
          if (res.ok) {
            const clone = res.clone()
            const body = await clone.text()
            await caches.open(CACHE).then((c) =>
              c.put(ASSESS_KEY, new Response(body, { headers: { 'Content-Type': 'application/json' } }))
            )
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.open(CACHE).then((c) => c.match(ASSESS_KEY))
          if (cached) return cached
          return new Response(JSON.stringify({ detail: 'offline and no cached assessment' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        })
    )
    return
  }

  // App shell: network-first with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put(event.request, copy))
          return res
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    )
  }
})
