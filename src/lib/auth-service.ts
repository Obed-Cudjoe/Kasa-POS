import { hashSecret, HttpError, sessionCookie } from './cloud'

const encoder = new TextEncoder()
const base64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function readAuthJson(request: Request, maxBytes = 16_384) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError(413, 'Request is too large.')
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new HttpError(413, 'Request is too large.')
  let value: unknown
  try { value = JSON.parse(raw) as unknown } catch { throw new HttpError(400, 'Request body must be valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Request body must be a JSON object.')
  return value as Record<string, unknown>
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value)
}

export function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export function emailLinkBase(request: Request, env: CloudflareEnv) {
  const incoming = new URL(request.url)
  if (['localhost','127.0.0.1'].includes(incoming.hostname)) return incoming.origin
  const configured = env.PUBLIC_APP_URL?.trim()
  if (configured) {
    const url = new URL(configured)
    if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) {
      throw new Error('PUBLIC_APP_URL must use HTTPS outside local development.')
    }
    return url.origin
  }
  throw new Error('Email link base URL is not configured.')
}

export async function sendAuthEmail(env: CloudflareEnv, to: string, subject: string, text: string, html: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL as Worker secrets/variables.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject, text, html }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Email delivery failed. Check the Resend sender configuration and retry.')
  } finally {
    clearTimeout(timeout)
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

export async function createEmailToken(
  db: D1Database,
  input: { purpose: 'verify' | 'reset' | 'invite'; email: string; userId?: string | null; employeeId?: string | null; storeId?: string | null; expiresAt: string },
) {
  const token = randomToken()
  const tokenHash = await hashSecret(token)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.prepare(`INSERT INTO auth_email_tokens (id, purpose, token_hash, email, user_id, employee_id, store_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.purpose, tokenHash, input.email, input.userId ?? null, input.employeeId ?? null, input.storeId ?? null, now, input.expiresAt).run()
  return token
}

export async function createSession(
  db: D1Database,
  request: Request,
  userId: string,
  employeeId: string,
  storeId: string,
) {
  const token = randomToken()
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString()
  await db.prepare(`INSERT INTO auth_sessions (id, token_hash, user_id, employee_id, store_id, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), await hashSecret(token), userId, employeeId, storeId, createdAt, expiresAt, createdAt).run()
  return { token, cookie: sessionCookie(request, token) }
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function rateKey(secret: string, scope: string, email: string, ip: string) {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${scope}\u0000${email}\u0000${ip}`))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Atomic per-email/IP throttling. The rate-limit key is HMACed so raw email/IP values are not persisted. */
export async function consumeAuthRateLimit(
  db: D1Database,
  request: Request,
  env: CloudflareEnv,
  scope: string,
  email: string,
  maxAttempts = 10,
  windowMs = 15 * 60_000,
  dimension: 'combined' | 'ip' | 'email' = 'combined',
) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 characters.')
  const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const keyEmail = dimension === 'ip' ? '' : email
  const ip = dimension === 'email' ? '' : clientIp
  const key = await rateKey(env.SESSION_SECRET, scope, keyEmail, ip)
  const now = Date.now()
  const reset = '(window_started_ms + ? <= ? OR (blocked_until_ms IS NOT NULL AND blocked_until_ms <= ?))'
  const result = await db.prepare(`INSERT INTO auth_rate_limits (key_hash, window_started_ms, attempts, blocked_until_ms)
      VALUES (?, ?, 1, NULL)
      ON CONFLICT (key_hash) DO UPDATE SET
        window_started_ms = CASE WHEN ${reset} THEN excluded.window_started_ms ELSE window_started_ms END,
        attempts = CASE WHEN ${reset} THEN 1 ELSE attempts + 1 END,
        blocked_until_ms = CASE
          WHEN blocked_until_ms > ? THEN blocked_until_ms
          WHEN ${reset} THEN NULL
          WHEN attempts + 1 > ? THEN ? + ?
          ELSE NULL END
      RETURNING attempts, blocked_until_ms`)
    .bind(key, now,
      windowMs, now, now,
      windowMs, now, now,
      now,
      windowMs, now, now,
      maxAttempts, now, windowMs)
    .first<{ attempts: number; blocked_until_ms: number | null }>()
  return Boolean(result && (Number(result.attempts) <= maxAttempts && !(result.blocked_until_ms && Number(result.blocked_until_ms) > now)))
}

export async function revokeTokenSession(db: D1Database, token: string) {
  if (!token) return
  const tokenHash = await hashSecret(token)
  await db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), tokenHash).run()
}
