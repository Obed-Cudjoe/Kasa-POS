import bcrypt from 'bcryptjs'
import { assertSameOrigin, hashSecret, HttpError } from '@/lib/cloud'
import { consumeAuthRateLimit, isValidPassword, readAuthJson } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { token?: unknown; password?: unknown }
    const token = typeof body?.token === 'string' ? body.token : ''
    if (token.length < 30 || token.length > 100 || !isValidPassword(body?.password)) {
      throw new HttpError(400, 'The reset link is invalid or expired, or the new password is too short.')
    }
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Password recovery is not configured.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'password-reset-submit-ip', '', 40, 15 * 60_000, 'ip')
    const tokenAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'password-reset-submit-token', await hashSecret(token), 8, 15 * 60_000, 'email')
    if (!ipAllowed || !tokenAllowed) throw new HttpError(429, 'Too many password-reset attempts. Request a fresh link later.')
    const tokenHash = await hashSecret(token)
    const now = new Date().toISOString()
    const reset = await env.DB.prepare(`SELECT id, user_id FROM auth_email_tokens
      WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ? AND user_id IS NOT NULL`)
      .bind(tokenHash, now).first<{ id: string; user_id: string }>()
    if (!reset) throw new HttpError(400, 'The reset link is invalid or expired. Request a fresh link.')
    const passwordHash = await bcrypt.hash(body.password, 10)
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE auth_users SET password_hash = ?, updated_at = ?
        WHERE id = ? AND status = 'active' AND EXISTS (
          SELECT 1 FROM auth_email_tokens WHERE id = ? AND user_id = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?)`)
        .bind(passwordHash, now, reset.user_id, reset.id, reset.user_id, now),
      env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE id = ? AND user_id = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?`)
        .bind(now, reset.id, reset.user_id, now),
      env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL`)
        .bind(now, reset.user_id),
      env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .bind(now, reset.user_id),
    ])
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new HttpError(400, 'The reset link is invalid or expired. Request a fresh link.')
    return Response.json({ ok: true, message: 'Password changed. Sign in with your new password.' }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: 'Password could not be changed. Request a fresh reset link and retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
