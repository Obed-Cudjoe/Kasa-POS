import { createHmac, timingSafeEqual } from 'node:crypto'

export async function paystackFetch(path: string, init: RequestInit = {}) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('Paystack is not configured for this deployment.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || data.status === false) {
      const message = typeof data.message === 'string' ? data.message : `Paystack returned HTTP ${response.status}.`
      throw new Error(message)
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

export function verifyPaystackSignature(rawBody: string, signature: string | null) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || !signature) return false
  const digest = createHmac('sha512', secret).update(rawBody).digest('hex')
  const expected = Buffer.from(digest, 'hex')
  let received: Buffer
  try { received = Buffer.from(signature, 'hex') } catch { return false }
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function randomProviderReference(prefix = 'KASA') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}
