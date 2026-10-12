import { authorizeRequest, HttpError, routeError } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner'])
    const body = await request.json().catch(() => null) as { employeeId?: unknown; displayName?: unknown; role?: unknown; refundLimitMinor?: unknown } | null
    const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : ''
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const role = typeof body?.role === 'string' ? body.role : ''
    const refundLimit = body?.refundLimitMinor
    if (!UUID_PATTERN.test(employeeId) || displayName.length < 2 || displayName.length > 100 || !['owner','manager','cashier'].includes(role)) {
      throw new HttpError(400, 'Employee ID, name, or role is invalid.')
    }
    if (role === 'owner' && refundLimit !== null && (!Number.isSafeInteger(refundLimit) || Number(refundLimit) < 0)) {
      throw new HttpError(400, 'An owner refund limit must be a non-negative safe integer or null for no cap.')
    }
    if (role !== 'owner' && (!Number.isSafeInteger(refundLimit) || Number(refundLimit) < 0)) {
      throw new HttpError(400, 'A manager or cashier must have a finite non-negative refund limit in pesewas.')
    }
    const { data: target, error: lookupError } = await actor.admin.from('employees')
      .select('id,role,status').eq('store_id', actor.storeId).eq('id', employeeId).maybeSingle()
    if (lookupError) throw new Error(lookupError.message)
    if (!target) throw new HttpError(404, 'Employee was not found in this store.')
    if (target.status === 'invited') throw new HttpError(409, 'Use the invitation form to update or resend an invited employee.')
    if (target.role === 'owner' && role !== 'owner') {
      const { data: owners, error: ownersError } = await actor.admin.from('employees').select('id')
        .eq('store_id', actor.storeId).eq('role', 'owner').eq('status', 'active')
      if (ownersError) throw new Error(ownersError.message)
      if (!Array.isArray(owners) || owners.length <= 1) throw new HttpError(409, 'A store must keep at least one active owner.')
    }
    const { data: updated, error: updateError } = await actor.admin.from('employees').update({
      display_name: displayName,
      role,
      refund_limit_minor: role === 'owner' && refundLimit === null ? null : Number(refundLimit),
      updated_at: new Date().toISOString(),
    }).eq('store_id', actor.storeId).eq('id', employeeId).eq('status', 'active')
      .select('id,store_id,auth_user_id,display_name,email,role,status,refund_limit_minor,created_at').maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) throw new HttpError(409, 'Employee profile changed; refresh and try again.')
    return Response.json({ ok: true, employee: updated }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } })
    return routeError(error)
  }
}
