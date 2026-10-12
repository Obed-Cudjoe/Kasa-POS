import bcrypt from 'bcryptjs'
import { assertSameOrigin, HttpError, sessionTokenFromRequest } from '@/lib/cloud'
import { consumeAuthRateLimit, createSession, isValidEmail, normalizeEmail, readAuthJson } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

const DUMMY_PASSWORD_HASH = '$2b$10$ODY2oqWIgRk9izyxu2yXiOIF6Oi0B3VrVkUEedBMStg6E7WLr02Ru'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { email?: unknown; password?: unknown }
    const email = normalizeEmail(body?.email)
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!isValidEmail(email) || password.length < 1 || password.length > 128) {
      throw new HttpError(400, 'Enter a valid email address and password.')
    }
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Cloud sign-in is not configured on this deployment.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'login-ip', '', 40, 15 * 60_000, 'ip')
    const accountAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'login-email', email, 10, 15 * 60_000, 'email')
    if (!ipAllowed || !accountAllowed) throw new HttpError(429, 'Too many sign-in attempts. Wait a little while and try again.')

    const user = await env.DB.prepare('SELECT id, email, password_hash, status, email_verified_at FROM auth_users WHERE email = ? COLLATE NOCASE')
      .bind(email).first<{ id: string; email: string; password_hash: string; status: string; email_verified_at: string | null }>()
    const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH).catch(() => false)
    if (!user || !passwordMatches || user.status !== 'active' || !user.email_verified_at) {
      return Response.json({ error: 'Email/password is incorrect or the email address has not been verified.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
    }
    const employee = await env.DB.prepare(`SELECT e.id, e.store_id FROM employees e
        JOIN stores s ON s.id = e.store_id
      WHERE e.auth_user_id = ? AND e.status = 'active'`)
      .bind(user.id).first<{ id: string; store_id: string }>()
    if (!employee) return Response.json({ error: 'Email/password is incorrect or the email address has not been verified.' }, { status: 401, headers: { 'cache-control': 'no-store' } })

    const session = await createSession(env.DB, request, user.id, employee.id, employee.store_id)
    // A successful login replaces the current browser session, not other device sessions.
    const oldToken = sessionTokenFromRequest(request)
    if (oldToken) {
      const { hashSecret } = await import('@/lib/cloud')
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), await hashSecret(oldToken)).run()
    }
    return Response.json({ ok: true }, {
      headers: { 'set-cookie': session.cookie, 'cache-control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: 'Sign-in could not be completed. Please retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
