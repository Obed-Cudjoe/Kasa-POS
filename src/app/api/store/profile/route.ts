import { authorizeRequest, HttpError, routeError } from '@/lib/cloud'
import { readAuthJson } from '@/lib/auth-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner'])
    const body = await readAuthJson(request, 4096)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Shop name must be between 2 and 120 characters.')
    const { data: store, error } = await actor.admin.from('stores').update({ name, updated_at: new Date().toISOString() })
      .eq('id', actor.storeId).select('id,name').maybeSingle()
    if (error) throw new Error(error.message)
    if (!store) throw new HttpError(404, 'Store profile was not found.')
    return Response.json({ ok: true, store: { id: store.id, name: store.name } }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return routeError(error)
  }
}
