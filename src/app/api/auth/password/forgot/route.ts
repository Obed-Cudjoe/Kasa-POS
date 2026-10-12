import { assertSameOrigin, HttpError, hashSecret } from '@/lib/cloud'
import { consumeAuthRateLimit, emailLinkBase, escapeHtml, isValidEmail, normalizeEmail, randomToken, readAuthJson, sendAuthEmail } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { email?: unknown }
    const email = normalizeEmail(body?.email)
    if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Password recovery is not configured.')
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new HttpError(503, 'Email delivery is not configured.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'password-reset-ip', '', 30, 60 * 60_000, 'ip')
    const emailAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'password-reset-email', email, 5, 60 * 60_000, 'email')
    if (!ipAllowed || !emailAllowed) throw new HttpError(429, 'Too many password-recovery requests. Please wait and try again.')
    const user = await env.DB.prepare(`SELECT id, display_name, status, email_verified_at FROM auth_users WHERE email = ? COLLATE NOCASE`)
      .bind(email).first<{ id: string; display_name: string; status: string; email_verified_at: string | null }>()
    if (user?.status === 'active' && user.email_verified_at) {
      const token = randomToken()
      const tokenHash = await hashSecret(token)
      const now = new Date().toISOString()
      const expires = new Date(Date.now() + 30 * 60_000).toISOString()
      await env.DB.batch([
        env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL`).bind(now, user.id),
        env.DB.prepare(`INSERT INTO auth_email_tokens (id, purpose, token_hash, email, user_id, created_at, expires_at)
          VALUES (?, 'reset', ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), tokenHash, email, user.id, now, expires),
      ])
      const base = emailLinkBase(request, env)
      const link = `${base}/?reset=${encodeURIComponent(token)}`
      const displayName = escapeHtml(user.display_name)
      await sendAuthEmail(env, email, 'Reset your Kasa POS password',
        `Hello ${user.display_name},\n\nChoose a new password within 30 minutes:\n${link}\n\nIf you did not request this, ignore the message.`,
        `<p>Hello ${displayName},</p><p>A password reset was requested for your Kasa POS account.</p><p><a href="${escapeHtml(link)}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this message.</p>`)
    }
    return Response.json({ ok: true, message: 'If an active account matches that address, a password-reset link has been sent.' }, { status: 202, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: 'Password-recovery email could not be sent. Please retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
