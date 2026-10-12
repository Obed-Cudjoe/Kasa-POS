import { assertSameOrigin, hashSecret, HttpError } from '@/lib/cloud'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Kasa POS</title><body style="font:16px system-ui,sans-serif;background:#f4f7f4;color:#173126;margin:0;padding:8vh 20px"><main style="max-width:520px;margin:auto;background:white;border:1px solid #dce6dd;border-radius:18px;padding:28px"><h1 style="font-size:24px">${title}</h1>${body}</main></body></html>`, {
  status,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  },
})

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (token.length < 30 || token.length > 100) return page('Invalid verification link', '<p>Request a fresh verification email and try again.</p>', 400)
  const escaped = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return page('Verify your email', `<p>Confirm that you control this email address to activate your Kasa POS account.</p><form method="post" action="/api/auth/verify-email"><input type="hidden" name="token" value="${escaped}"><button style="border:0;border-radius:10px;padding:12px 18px;background:#176d42;color:white;font-weight:700;cursor:pointer">Verify email address</button></form><p style="color:#5d7064;font-size:13px">This link is single-use and expires after 24 hours.</p>`)
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const form = await request.formData()
    const token = String(form.get('token') ?? '')
    if (token.length < 30 || token.length > 100) throw new HttpError(400, 'Verification link is invalid or expired.')
    const env = await getWorkerEnv()
    if (!env.DB) throw new HttpError(503, 'Account service is not configured.')
    const tokenHash = await hashSecret(token)
    const now = new Date().toISOString()
    const row = await env.DB.prepare(`SELECT id, user_id FROM auth_email_tokens
      WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > ? AND user_id IS NOT NULL`)
      .bind(tokenHash, now).first<{ id: string; user_id: string }>()
    if (!row) throw new HttpError(400, 'Verification link is invalid or expired. Request a new link.')
    await env.DB.batch([
      env.DB.prepare(`UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ? AND status = 'active'`)
        .bind(now, now, row.user_id),
      env.DB.prepare('UPDATE auth_email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now, row.id),
    ])
    return page('Email verified', '<p>Your email address is verified. You can now sign in to your Kasa POS store.</p><p><a href="/?verified=1" style="color:#176d42;font-weight:700">Return to Kasa POS</a></p>')
  } catch (error) {
    if (error instanceof HttpError) return page('Verification could not be completed', `<p>${error.message.replace(/[&<>]/g, '')}</p><p><a href="/">Return to Kasa POS</a></p>`, error.status)
    return page('Verification could not be completed', '<p>Please request a fresh verification email and retry.</p><p><a href="/">Return to Kasa POS</a></p>', 503)
  }
}
