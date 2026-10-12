import bcrypt from 'bcryptjs'
import { assertSameOrigin, HttpError } from '@/lib/cloud'
import { consumeAuthRateLimit, emailLinkBase, escapeHtml, isValidEmail, isValidPassword, normalizeEmail, randomToken, readAuthJson, sendAuthEmail } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'
import { hashSecret } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readAuthJson(request) as { storeName?: unknown; displayName?: unknown; email?: unknown; password?: unknown }
    const storeName = typeof body?.storeName === 'string' ? body.storeName.trim() : ''
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const email = normalizeEmail(body?.email)
    if (storeName.length < 2 || storeName.length > 120 || displayName.length < 2 || displayName.length > 100 || !isValidEmail(email) || !isValidPassword(body?.password)) {
      throw new HttpError(400, 'Enter a store name, owner name, valid email, and a password of at least 12 characters.')
    }
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Account registration is not configured on this deployment.')
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new HttpError(503, 'Email verification is not configured yet. Ask the operator to finish email setup.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'register-ip', '', 20, 60 * 60_000, 'ip')
    const emailAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'register-email', email, 5, 60 * 60_000, 'email')
    if (!ipAllowed || !emailAllowed) throw new HttpError(429, 'Too many registration attempts. Please wait and try again later.')

    const existing = await env.DB.prepare('SELECT id FROM auth_users WHERE email = ? COLLATE NOCASE').bind(email).first<{ id: string }>()
    const invited = await env.DB.prepare(`SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND status = 'invited'`).bind(email).first<{ id: string }>()
    if (existing || invited) {
      return Response.json({ ok: true, message: 'If this address is eligible for a new store account, instructions will be sent to it.' }, { status: 202, headers: { 'cache-control': 'no-store' } })
    }

    const passwordHash = await bcrypt.hash(body.password, 10)
    const userId = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const employeeId = crypto.randomUUID()
    const rawToken = randomToken()
    const tokenHash = await hashSecret(rawToken)
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO stores (id, name, country_code, base_currency, timezone, tax_registration_status, e_vat_status, settings, created_at, updated_at)
        VALUES (?, ?, 'GH', 'GHS', 'Africa/Accra', 'unverified', 'not_configured', '{}', ?, ?)`)
        .bind(storeId, storeName, now, now),
      env.DB.prepare(`INSERT INTO auth_users (id, email, display_name, password_hash, status, platform_role, email_verified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', 'user', NULL, ?, ?)`)
        .bind(userId, email, displayName, passwordHash, now, now),
      env.DB.prepare(`INSERT INTO employees (id, store_id, auth_user_id, display_name, email, role, status, refund_limit_minor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'owner', 'active', NULL, ?, ?)`)
        .bind(employeeId, storeId, userId, displayName, email, now, now),
      env.DB.prepare(`INSERT INTO auth_email_tokens (id, purpose, token_hash, email, user_id, employee_id, store_id, created_at, expires_at)
        VALUES (?, 'verify', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), tokenHash, email, userId, employeeId, storeId, now, expires),
    ])

    const base = emailLinkBase(request, env)
    const link = `${base}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`
    const safeName = escapeHtml(displayName)
    await sendAuthEmail(env, email, 'Verify your Kasa POS account',
      `Hello ${displayName},\n\nVerify your email address for ${storeName} by opening this link:\n${link}\n\nThis link expires in 24 hours. If you did not create this account, ignore this message.`,
      `<p>Hello ${safeName},</p><p>Verify your email address for <strong>${escapeHtml(storeName)}</strong>.</p><p><a href="${escapeHtml(link)}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this message.</p>`)
    return Response.json({ ok: true, message: 'If this address is eligible for a new store account, instructions will be sent to it.' }, { status: 202, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return Response.json({ error: error instanceof Error && /email|Resend/i.test(error.message) ? error.message : 'Registration could not be completed. Please retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
