import type { UserRole } from './types'
import { D1DataClient, getWorkerEnv, type DbError } from './d1'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface RequestActor {
  userId: string
  employeeId: string
  storeId: string
  displayName: string
  role: UserRole
  refundLimitMinor: number | null
  admin: D1DataClient
}

export function createAdminClient() {
  return new D1DataClient()
}

export async function hasCloudConfiguration() {
  try {
    const env = await getWorkerEnv()
    return Boolean(env.DB)
  } catch {
    return false
  }
}

export async function getRuntimeConfiguration() {
  try {
    const env = await getWorkerEnv()
    return { cloudConfigured: Boolean(env.DB), paymentsConfigured: Boolean(env.PAYSTACK_SECRET_KEY), env }
  } catch {
    return { cloudConfigured: false, paymentsConfigured: false, env: null }
  }
}

export function assertSameOrigin(request: Request) {
  const method = request.method.toUpperCase()
  if (['GET','HEAD','OPTIONS'].includes(method)) return
  const origin = request.headers.get('origin')
  let expected: string
  try { expected = new URL(request.url).origin } catch { throw new HttpError(400, 'Invalid request origin.') }
  if (!origin || origin !== expected) throw new HttpError(403, 'Cross-origin request rejected.')
}

export function sessionCookieName(request: Request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-kasa_session' : 'kasa_session'
}

export function sessionTokenFromRequest(request: Request) {
  const cookies = new Map<string, string>()
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name && value) cookies.set(name, value)
  }
  return cookies.get(sessionCookieName(request)) ?? cookies.get('__Host-kasa_session') ?? cookies.get('kasa_session') ?? ''
}

export async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sessionCookie(request: Request, rawToken: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const secure = new URL(request.url).protocol === 'https:'
  const name = secure ? '__Host-kasa_session' : 'kasa_session'
  return `${name}=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(request: Request) {
  return sessionCookie(request, '', 0)
}

export async function authorizeRequest(request: Request, permittedRoles?: UserRole[]): Promise<RequestActor> {
  assertSameOrigin(request)
  const token = sessionTokenFromRequest(request)
  if (!token) throw new HttpError(401, 'Sign in to continue.')
  let env: CloudflareEnv
  try { env = await getWorkerEnv() } catch { throw new HttpError(503, 'Cloud services are not configured on this deployment.') }
  if (!env.DB) throw new HttpError(503, 'Cloud services are not configured on this deployment.')
  const tokenHash = await hashSecret(token)
  const now = new Date().toISOString()
  const profile = await env.DB.prepare(`SELECT
      s.id AS session_id, s.user_id, s.employee_id, s.store_id, s.expires_at, s.last_seen_at,
      u.status AS user_status, u.email_verified_at,
      e.display_name, e.role, e.status AS employee_status, e.refund_limit_minor
    FROM auth_sessions s
    JOIN auth_users u ON u.id = s.user_id
    JOIN employees e ON e.id = s.employee_id AND e.store_id = s.store_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .bind(tokenHash, now).first<{
      session_id: string; user_id: string; employee_id: string; store_id: string; expires_at: string; last_seen_at: string;
      user_status: string; email_verified_at: string | null; display_name: string; role: UserRole;
      employee_status: string; refund_limit_minor: number | null;
    }>()
  if (!profile || profile.user_status !== 'active' || !profile.email_verified_at || profile.employee_status !== 'active') {
    throw new HttpError(401, 'Your session has expired or is no longer active. Sign in again.')
  }
  if (permittedRoles && !permittedRoles.includes(profile.role)) {
    throw new HttpError(403, 'Your role does not have permission to perform this action.')
  }
  const lastSeen = Date.parse(profile.last_seen_at)
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 15 * 60_000) {
    await env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(now, profile.session_id).run()
  }
  return {
    userId: profile.user_id,
    employeeId: profile.employee_id,
    storeId: profile.store_id,
    displayName: profile.display_name,
    role: profile.role,
    refundLimitMinor: profile.refund_limit_minor == null ? null : Number(profile.refund_limit_minor),
    admin: new D1DataClient(env.DB),
  }
}

export function routeError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
  if (error && typeof error === 'object' && 'message' in error && typeof (error as DbError).message === 'string') {
    const message = (error as DbError).message
    if (/sign in|session has expired/i.test(message)) return Response.json({ error: message }, { status: 401 })
    if (/permission|role does not/i.test(message)) return Response.json({ error: message }, { status: 403 })
    if (/not configured/i.test(message)) return Response.json({ error: message }, { status: 503 })
    if (/not linked/i.test(message)) return Response.json({ error: message }, { status: 403 })
  }
  return Response.json({ error: 'The request could not be completed. Please retry.' }, { status: 500, headers: { 'cache-control': 'no-store' } })
}
