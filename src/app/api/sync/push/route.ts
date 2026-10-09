import { authorizeRequest, routeError } from '@/lib/cloud'
import type { SyncEventType, UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

const privilegedEvents = new Set<SyncEventType>(['refund', 'product', 'tax', 'employee'])

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
      if (privilegedEvents.has(eventType) && !(['owner', 'manager'] as UserRole[]).includes(actor.role)) {
        results.push({ eventId, status: 'rejected', error: 'Only an owner or manager can sync this change.' })
        continue
      }
      if (eventType === 'inventory_movement' && !(['owner', 'manager'] as UserRole[]).includes(actor.role)) {
        results.push({ eventId, status: 'rejected', error: 'Only an owner or manager can sync a manual stock adjustment.' })
        continue
      }
      const { data: employee, error: employeeError } = await actor.admin
        .from('employees').select('id,role').eq('store_id', actor.storeId).eq('id', employeeId).eq('status', 'active').maybeSingle()
      if (employeeError || !employee) {
        results.push({ eventId, status: 'rejected', error: 'The event employee is not active in this store.' })
        continue
      }
      if (actor.role === 'cashier' && employeeId !== actor.employeeId) {
        results.push({ eventId, status: 'rejected', error: 'Cashiers may only sync changes attributed to their own profile.' })
        continue
      }
      if (actor.role === 'manager' && employee.role === 'owner') {
        results.push({ eventId, status: 'rejected', error: 'Managers cannot sync changes attributed to an owner profile.' })
        continue
      }
      if (eventType === 'employee' && actor.role === 'manager') {
        const target = (event.payload as { employee?: { id?: string; role?: string } } | undefined)?.employee
        if (target?.role === 'owner') {
          results.push({ eventId, status: 'rejected', error: 'Only an owner can grant the owner role.' })
          continue
        }
        if (target?.id) {
          const { data: existingTarget } = await actor.admin.from('employees').select('role').eq('store_id', actor.storeId).eq('id', target.id).maybeSingle()
          if (existingTarget?.role === 'owner') {
            results.push({ eventId, status: 'rejected', error: 'Managers cannot edit an owner profile.' })
            continue
          }
        }
      }
      const normalizedEvent = { ...event, eventId, storeId, deviceId, employeeId, eventType }
      const { data, error } = await actor.admin.rpc('ingest_pos_event', { p_event: normalizedEvent })
      if (error) results.push({ eventId, status: 'rejected', error: error.message })
      else results.push({ eventId, status: data?.status ?? 'accepted', summary: data?.summary })
    }

    return Response.json({ results, serverTime: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
