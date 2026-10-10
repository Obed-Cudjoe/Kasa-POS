import { authorizeRequest, routeError } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    return Response.json({
      employee: { id: actor.employeeId, storeId: actor.storeId, displayName: actor.displayName, role: actor.role, refundLimitMinor: actor.refundLimitMinor },
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
