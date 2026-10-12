import { getWorkerEnv } from './d1'

export async function paystackFetch(path: string, init: RequestInit = {}) {
  const env = await getWorkerEnv()
  const secret = env.PAYSTACK_SECRET_KEY
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

export async function verifyPaystackSignature(rawBody: string, signature: string | null) {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false
  const env = await getWorkerEnv()
  const secret = env.PAYSTACK_SECRET_KEY
  if (!secret) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  let difference = expected.length ^ signature.length
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i)
  return difference === 0
}

export function randomProviderReference(prefix = 'KASA') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}
