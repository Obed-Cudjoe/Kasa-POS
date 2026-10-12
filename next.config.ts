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
  allowedDevOrigins: ['*.e2b.app'],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), bluetooth=(self), usb=(self)' },
      ],
    }]
  },
})
