import { authorizeRequest, HttpError, hashSecret } from '@/lib/cloud'
import { consumeAuthRateLimit, emailLinkBase, escapeHtml, isValidEmail, normalizeEmail, randomToken, readAuthJson, sendAuthEmail } from '@/lib/auth-service'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner'])
    const body = await readAuthJson(request) as { email?: unknown; displayName?: unknown; role?: unknown; refundLimitMinor?: unknown }
    const email = normalizeEmail(body?.email)
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const role = body?.role
    const refundLimit = body?.refundLimitMinor === undefined ? 0 : body.refundLimitMinor
    if (!isValidEmail(email) || displayName.length < 2 || displayName.length > 100 || !['manager','cashier'].includes(String(role))) {
      throw new HttpError(400, 'Enter a valid staff name, email, and manager or cashier role.')
    }
    if (!Number.isSafeInteger(refundLimit) || Number(refundLimit) < 0) {
      throw new HttpError(400, 'Refund limit must be a non-negative safe integer in GHS pesewas.')
    }
    const env = await getWorkerEnv()
    if (!env.DB || !env.SESSION_SECRET) throw new HttpError(503, 'Staff invitations are not configured.')
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new HttpError(503, 'Email delivery is not configured.')
    const ipAllowed = await consumeAuthRateLimit(env.DB, request, env, 'staff-invite-ip', '', 40, 60 * 60_000, 'ip')
    const emailAllowed = ipAllowed && await consumeAuthRateLimit(env.DB, request, env, 'staff-invite-email', email, 8, 60 * 60_000, 'email')
    if (!ipAllowed || !emailAllowed) throw new HttpError(429, 'Too many invitation attempts for this email. Wait and try again later.')
    const account = await env.DB.prepare('SELECT id FROM auth_users WHERE email = ? COLLATE NOCASE').bind(email).first<{ id: string }>()
    if (account) throw new HttpError(409, 'That email already has an account. Ask the staff member to sign in or contact the owner.')
    const existing = await env.DB.prepare(`SELECT id, status FROM employees WHERE store_id = ? AND email = ? COLLATE NOCASE`)
      .bind(actor.storeId, email).first<{ id: string; status: string }>()
    if (existing && existing.status !== 'invited') throw new HttpError(409, 'An active or disabled staff profile already uses that email in this store.')
    const elsewhere = await env.DB.prepare(`SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND store_id <> ? AND status <> 'disabled'`)
      .bind(email, actor.storeId).first<{ id: string }>()
    if (elsewhere) throw new HttpError(409, 'That email is already assigned to another store account.')

    const employeeId = existing?.id ?? crypto.randomUUID()
    const token = randomToken()
    const tokenHash = await hashSecret(token)
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const changes: D1PreparedStatement[] = []
    if (existing) {
      changes.push(env.DB.prepare(`UPDATE employees SET display_name = ?, role = ?, status = 'invited', refund_limit_minor = ?, updated_at = ?
        WHERE store_id = ? AND id = ? AND status = 'invited'`)
        .bind(displayName, role, Number(refundLimit), now, actor.storeId, employeeId))
      changes.push(env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE employee_id = ? AND purpose = 'invite' AND used_at IS NULL`)
        .bind(now, employeeId))
    } else {
      changes.push(env.DB.prepare(`INSERT INTO employees (id, store_id, display_name, email, role, status, refund_limit_minor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, ?)`)
        .bind(employeeId, actor.storeId, displayName, email, role, Number(refundLimit), now, now))
    }
    changes.push(env.DB.prepare(`INSERT INTO auth_email_tokens (id, purpose, token_hash, email, employee_id, store_id, created_at, expires_at)
      VALUES (?, 'invite', ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tokenHash, email, employeeId, actor.storeId, now, expires))
    await env.DB.batch(changes)

    const link = `${emailLinkBase(request, env)}/?invite=${encodeURIComponent(token)}`
    const safeName = escapeHtml(displayName)
    const store = await env.DB.prepare('SELECT name FROM stores WHERE id = ?').bind(actor.storeId).first<{ name: string }>()
    const storeName = store?.name ?? 'your store'
    await sendAuthEmail(env, email, `Invitation to join ${storeName} on Kasa POS`,
      `Hello ${displayName},\n\n${actor.displayName} invited you to join ${storeName} as a ${String(role)}. Open this link within 7 days to set your password and activate your staff profile:\n${link}\n\nIf you were not expecting this invitation, ignore this email.`,
      `<p>Hello ${safeName},</p><p>${escapeHtml(actor.displayName)} invited you to join <strong>${escapeHtml(storeName)}</strong> as a ${escapeHtml(String(role))}.</p><p><a href="${escapeHtml(link)}">Accept staff invitation</a></p><p>This invitation expires in 7 days. If you were not expecting it, ignore this message.</p>`)

    return Response.json({ ok: true, employee: {
      id: employeeId, storeId: actor.storeId, displayName, email, role, status: 'invited',
      refundLimitMinor: Number(refundLimit), createdAt: existing ? undefined : now,
    } }, { status: existing ? 200 : 201, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    if (error instanceof Error && /sign in|session has expired|permission|role does not/i.test(error.message)) {
      const status = /permission|role does not/i.test(error.message) ? 403 : 401
      return Response.json({ error: error.message }, { status, headers: { 'cache-control': 'no-store' } })
    }
    return Response.json({ error: 'Staff invitation could not be created. Please retry.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
