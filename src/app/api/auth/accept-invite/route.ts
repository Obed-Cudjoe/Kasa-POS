import bcrypt from 'bcryptjs'
import { assertSameOrigin, hashSecret, HttpError, sessionCookie } from '@/lib/cloud'
import { consumeAuthRateLimit, isValidPassword, randomToken, readAuthJson } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { token?: unknown; password?: unknown }
    const token = typeof body?.token === 'string' ? body.token : ''
    if (token.length < 30 || token.length > 100 || !isValidPassword(body?.password)) {
      throw new HttpError(400, 'Invitation link is invalid or expired, or the password is too short.')
    }
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Staff account activation is not configured.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'invite-accept-ip', '', 40, 15 * 60_000, 'ip')
    const tokenAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'invite-accept-token', await hashSecret(token), 8, 15 * 60_000, 'email')
    if (!ipAllowed || !tokenAllowed) throw new HttpError(429, 'Too many activation attempts. Request a fresh invitation later.')
    const now = new Date().toISOString()
    const tokenHash = await hashSecret(token)
    const invite = await env.DB.prepare(`SELECT t.id AS token_id, t.email, t.employee_id, t.store_id,
        e.display_name, e.role, e.status, e.refund_limit_minor, s.name AS store_name
      FROM auth_email_tokens t
      JOIN employees e ON e.id = t.employee_id AND e.store_id = t.store_id
      JOIN stores s ON s.id = t.store_id
      WHERE t.token_hash = ? AND t.purpose = 'invite' AND t.used_at IS NULL AND t.expires_at > ?`)
      .bind(tokenHash, now).first<{
        token_id: string; email: string; employee_id: string; store_id: string; display_name: string;
        role: string; status: string; refund_limit_minor: number | null; store_name: string;
      }>()
    if (!invite || invite.status !== 'invited' || !['manager','cashier'].includes(invite.role)) {
      throw new HttpError(400, 'Invitation link is invalid, expired, or already used. Ask the owner to send a fresh invitation.')
    }
    const existing = await env.DB.prepare('SELECT id FROM auth_users WHERE email = ? COLLATE NOCASE').bind(invite.email).first<{ id: string }>()
    if (existing) throw new HttpError(409, 'This email already has an account. Contact the store owner for help linking access.')

    const userId = crypto.randomUUID()
    const passwordHash = await bcrypt.hash(body.password, 10)
    const sessionToken = randomToken()
    const sessionHash = await hashSecret(sessionToken)
    const sessionId = crypto.randomUUID()
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO auth_users (id, email, display_name, password_hash, status, platform_role, email_verified_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'active', 'user', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM auth_email_tokens t JOIN employees e ON e.id = t.employee_id AND e.store_id = t.store_id
          WHERE t.id = ? AND t.purpose = 'invite' AND t.used_at IS NULL AND t.expires_at > ? AND e.status = 'invited' AND e.email = ? COLLATE NOCASE)`)
        .bind(userId, invite.email, invite.display_name, passwordHash, now, now, now, invite.token_id, now, invite.email),
      env.DB.prepare(`UPDATE employees SET auth_user_id = ?, status = 'active', updated_at = ?
        WHERE id = ? AND store_id = ? AND status = 'invited' AND email = ? COLLATE NOCASE`)
        .bind(userId, now, invite.employee_id, invite.store_id, invite.email),
      env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE id = ? AND purpose = 'invite' AND used_at IS NULL AND expires_at > ?`)
        .bind(now, invite.token_id, now),
      env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE employee_id = ? AND purpose = 'invite' AND used_at IS NULL`)
        .bind(now, invite.employee_id),
      env.DB.prepare(`INSERT INTO auth_sessions (id, token_hash, user_id, employee_id, store_id, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(sessionId, sessionHash, userId, invite.employee_id, invite.store_id, now, expires, now),
    ])
    if (Number(results[1]?.meta?.changes ?? 0) !== 1 || Number(results[2]?.meta?.changes ?? 0) !== 1) {
      throw new HttpError(409, 'This invitation was already accepted or has expired. Ask the owner to send a fresh invitation.')
    }
    return Response.json({ ok: true, employee: {
      id: invite.employee_id, storeId: invite.store_id, authUserId: userId,
      displayName: invite.display_name, email: invite.email, role: invite.role,
      refundLimitMinor: invite.refund_limit_minor, status: 'active', createdAt: now,
    } }, { headers: { 'set-cookie': sessionCookie(request, sessionToken), 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: 'Invitation could not be activated. Request a fresh invitation and retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
