import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from 'serwist'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'

// Next.js injects this manifest during production build.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: WorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined }

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  precacheOptions: { cleanupOutdatedCaches: true, ignoreURLParametersMatching: [/^utm_/, /^fbclid$/] },
  runtimeCaching: [
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({ cacheName: 'kasa-pages-v1', networkTimeoutSeconds: 3 }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({
        cacheName: 'kasa-next-static-v1',
        plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    {
      matcher: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/assets/'),
      handler: new CacheFirst({
        cacheName: 'kasa-assets-v1',
        plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
  ],
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }],
  },
})

serwist.addEventListeners()
