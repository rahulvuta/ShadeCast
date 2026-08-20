/* ShadeCast offline cache — app shell + assess responses keyed by full URL. */
const CACHE = 'shadecast-shell-v10'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return

  // Cache successful assess responses keyed by full request URL (includes lat/lon).
  if (url.pathname.startsWith('/api/assess')) {
    event.respondWith(
      fetch(event.request)
        .then(async (res) => {
          if (res.ok) {
            const clone = res.clone()
            const body = await clone.text()
            await caches.open(CACHE).then((c) =>
              c.put(event.request, new Response(body, { headers: { 'Content-Type': 'application/json' } }))
            )
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.open(CACHE).then((c) => c.match(event.request))
          if (cached) return cached
          return new Response(JSON.stringify({ detail: 'offline and no cached assessment for this location' }), {
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
