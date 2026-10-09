import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/service-worker-register'

export const metadata: Metadata = {
  title: 'Kasa POS · Offline-first checkout',
  description: 'A tablet-friendly, local-first point-of-sale starter for independent retailers.',
  applicationName: 'Kasa POS',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Kasa POS' },
  formatDetection: { telephone: false },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#124f3c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
