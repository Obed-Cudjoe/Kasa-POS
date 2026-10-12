import { authorizeRequest, routeError } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const { data: store, error: storeError } = await actor.admin.from('stores').select('id,name').eq('id', actor.storeId).maybeSingle()
    if (storeError || !store) throw new Error(storeError?.message ?? 'Store profile was not found.')
    return Response.json({
      store: { id: store.id, name: store.name },
      employee: {
        id: actor.employeeId,
        storeId: actor.storeId,
        authUserId: actor.userId,
        displayName: actor.displayName,
        role: actor.role,
        refundLimitMinor: actor.refundLimitMinor,
        status: 'active',
      },
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
