import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  cacheOnNavigation: true,
  additionalPrecacheEntries: [
    { url: '/', revision: 'app-shell-v1' },
    { url: '/offline', revision: 'offline-v1' },
    { url: '/manifest.webmanifest', revision: 'manifest-v1' },
  ],
})

export default withSerwist({
  reactStrictMode: true,
  poweredByHeader: false,
})
