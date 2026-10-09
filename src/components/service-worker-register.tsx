'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
    let active = true
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
      if (!active) return
      registration.update().catch(() => undefined)
    }).catch((error) => console.warn('Service worker registration failed:', error))
    return () => { active = false }
  }, [])
  return null
}
