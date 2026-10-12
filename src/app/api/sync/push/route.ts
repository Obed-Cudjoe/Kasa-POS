import { authorizeRequest, routeError } from '@/lib/cloud'
import { isWithinRefundLimit } from '@/lib/permissions'
import type { SyncEventType, UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

const privilegedEvents = new Set<SyncEventType>(['product', 'tax'])

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const body = await request.json().catch(() => ({})) as { events?: Array<Record<string, unknown>> }
    const events = Array.isArray(body.events) ? body.events : []
    if (!events.length || events.length > 100) return Response.json({ error: 'Send between 1 and 100 sync events.' }, { status: 400 })
    const results: Array<{ eventId: string; status: string; summary?: unknown; error?: string }> = []

    for (const event of events) {
      const eventType = event.eventType as SyncEventType
      const eventId = String(event.eventId ?? '')
      const storeId = String(event.storeId ?? '')
      const deviceId = String(event.deviceId ?? '')
      const employeeId = String(event.employeeId ?? '')
      if (!eventId || storeId !== actor.storeId || !deviceId || !employeeId) {
        results.push({ eventId, status: 'rejected', error: 'Event identity or store does not match the signed-in account.' })
        continue
      }
      if (eventType === 'employee') {
        results.push({ eventId, status: 'rejected', error: 'Employee access is managed through owner-issued invitations and the employee role API.' })
        continue
      }
      if (privilegedEvents.has(eventType) && !(['owner', 'manager'] as UserRole[]).includes(actor.role)) {
        results.push({ eventId, status: 'rejected', error: 'Only an owner or manager can sync this change.' })
        continue
      }
      if (eventType === 'inventory_movement' && !(['owner', 'manager'] as UserRole[]).includes(actor.role)) {
        results.push({ eventId, status: 'rejected', error: 'Only an owner or manager can sync a manual stock adjustment.' })
        continue
      }
      const { data: employee, error: employeeError } = await actor.admin
        .from('employees').select('id,role,refund_limit_minor').eq('store_id', actor.storeId).eq('id', employeeId).eq('status', 'active').maybeSingle()
      if (employeeError || !employee) {
        results.push({ eventId, status: 'rejected', error: 'The event employee is not active in this store.' })
        continue
      }
      if (eventType === 'refund') {
        const refund = (event.payload as { refund?: { amountMinor?: unknown } } | undefined)?.refund
        const amountMinor = Number(refund?.amountMinor)
        const limitMinor = employee.refund_limit_minor === null ? null : Number(employee.refund_limit_minor ?? 0)
        if (!isWithinRefundLimit(amountMinor, limitMinor)) {
          results.push({ eventId, status: 'rejected', error: 'Refund exceeds the event employee’s configured authorization limit.' })
          continue
        }
      }
      if (actor.role === 'cashier' && employeeId !== actor.employeeId) {
        results.push({ eventId, status: 'rejected', error: 'Cashiers may only sync changes attributed to their own profile.' })
        continue
      }
      if (actor.role === 'manager' && employee.role === 'owner') {
        results.push({ eventId, status: 'rejected', error: 'Managers cannot sync changes attributed to an owner profile.' })
        continue
      }
      const normalizedEvent = { ...event, eventId, storeId, deviceId, employeeId, eventType }
      const { data, error } = await actor.admin.rpc<{ status?: string; summary?: unknown }>('ingest_pos_event', { p_event: normalizedEvent })
      if (error) results.push({ eventId, status: 'rejected', error: error.message })
      else results.push({ eventId, status: data?.status ?? 'accepted', summary: data?.summary })
    }

    return Response.json({ results, serverTime: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
