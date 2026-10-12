import { assertSameOrigin, HttpError, hashSecret } from '@/lib/cloud'
import { consumeAuthRateLimit, emailLinkBase, escapeHtml, normalizeEmail, randomToken, readAuthJson, sendAuthEmail } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { email?: unknown }
    const email = normalizeEmail(body?.email)
    if (!email || email.length > 254) throw new HttpError(400, 'Enter a valid email address.')
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Account email is not configured.')
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new HttpError(503, 'Email delivery is not configured.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'verify-resend-ip', '', 30, 60 * 60_000, 'ip')
    const emailAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'verify-resend-email', email, 4, 60 * 60_000, 'email')
    if (!ipAllowed || !emailAllowed) throw new HttpError(429, 'Too many email requests. Please wait and try again.')
    const user = await env.DB.prepare(`SELECT id, display_name, email_verified_at FROM auth_users WHERE email = ? COLLATE NOCASE AND status = 'active'`)
      .bind(email).first<{ id: string; display_name: string; email_verified_at: string | null }>()
    if (user && !user.email_verified_at) {
      const token = randomToken()
      const tokenHash = await hashSecret(token)
      const now = new Date().toISOString()
      const expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
      await env.DB.batch([
        env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE email = ? COLLATE NOCASE AND purpose = 'verify' AND used_at IS NULL`).bind(now, email),
        env.DB.prepare(`INSERT INTO auth_email_tokens (id, purpose, token_hash, email, user_id, created_at, expires_at)
          VALUES (?, 'verify', ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), tokenHash, email, user.id, now, expires),
      ])
      const base = emailLinkBase(request, env)
      const link = `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`
      const name = escapeHtml(user.display_name)
      await sendAuthEmail(env, email, 'Verify your Kasa POS account',
        `Hello ${user.display_name},\n\nVerify your email address by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
        `<p>Hello ${name},</p><p>Verify your email address.</p><p><a href="${escapeHtml(link)}">Verify email address</a></p><p>This link expires in 24 hours.</p>`)
    }
    return Response.json({ ok: true, message: 'If this account needs verification, a fresh link has been sent.' }, { status: 202, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: 'Verification email could not be sent. Please retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
