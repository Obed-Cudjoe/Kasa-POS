import { assertSameOrigin, clearedSessionCookie, sessionTokenFromRequest, hashSecret } from '@/lib/cloud'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const token = sessionTokenFromRequest(request)
    if (token) {
      const env = await getWorkerEnv()
      if (env.DB) await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), await hashSecret(token)).run()
    }
    return Response.json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie(request), 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Sign-out could not be completed.' }, { status: 503, headers: { 'set-cookie': clearedSessionCookie(request), 'cache-control': 'no-store' } })
  }
}
