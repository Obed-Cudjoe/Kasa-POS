import Link from 'next/link'

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <div className="offline-card">
        <span className="brand-mark">K</span>
        <p className="eyebrow">KASA POS</p>
        <h1>You’re offline.</h1>
        <p>Your catalogue, checkout and recent transactions are stored on this device. Reopen the POS when the app shell is cached and continue with cash sales.</p>
        <Link href="/">Return to checkout</Link>
        <small>Digital payments stay pending until a provider confirms them. This screen does not confirm a payment.</small>
      </div>
    </main>
  )
}
