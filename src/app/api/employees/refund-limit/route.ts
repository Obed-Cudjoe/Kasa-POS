import { authorizeRequest, routeError } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner'])
    const body = await request.json().catch(() => ({})) as { employeeId?: unknown; refundLimitMinor?: unknown }
    if (typeof body.employeeId !== 'string' || !UUID_PATTERN.test(body.employeeId)) {
      return Response.json({ error: 'A valid employee ID is required.' }, { status: 400 })
    }
    const limit = body.refundLimitMinor
    if (limit !== null && (!Number.isSafeInteger(limit) || Number(limit) < 0)) {
      return Response.json({ error: 'Refund limit must be a non-negative safe integer in GHS pesewas, or null for no cap.' }, { status: 400 })
    }
    const { data: target, error: lookupError } = await actor.admin.from('employees').select('id,role')
      .eq('store_id', actor.storeId).eq('id', body.employeeId).maybeSingle()
    if (lookupError || !target) return Response.json({ error: 'Employee was not found in this store.' }, { status: 404 })
    if (limit === null && target.role !== 'owner') {
      return Response.json({ error: 'Only an owner profile may have no per-transaction refund cap. Set a finite limit for managers and cashiers.' }, { status: 400 })
    }
    const { data: updated, error: updateError } = await actor.admin.from('employees')
      .update({ refund_limit_minor: limit }).eq('store_id', actor.storeId).eq('id', target.id)
      .select('id,refund_limit_minor').maybeSingle()
    if (updateError || !updated) throw new Error(`Refund limit could not be saved: ${updateError?.message ?? 'employee update did not complete'}`)
    return Response.json({ ok: true, employeeId: updated.id, refundLimitMinor: updated.refund_limit_minor }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
