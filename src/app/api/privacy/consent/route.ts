import { authorizeRequest, routeError } from '@/lib/cloud'
import { isPrivacyConsentPurpose, PRIVACY_NOTICE_VERSION } from '@/lib/privacy'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const body = await request.json().catch(() => ({})) as { orderId?: unknown; purpose?: unknown; policyVersion?: unknown }
    if (typeof body.orderId !== 'string' || !UUID_PATTERN.test(body.orderId) || !isPrivacyConsentPurpose(body.purpose)) {
      return Response.json({ error: 'A valid order ID and consent purpose are required.' }, { status: 400 })
    }
    if (body.policyVersion !== PRIVACY_NOTICE_VERSION) {
      return Response.json({ error: 'The privacy notice version has changed. Review it and ask the customer for consent again.' }, { status: 409 })
    }
    const { data: order, error: orderError } = await actor.admin.from('orders')
      .select('id,employee_id').eq('store_id', actor.storeId).eq('id', body.orderId).maybeSingle()
    if (orderError || !order) return Response.json({ error: 'The order was not found in the signed-in store.' }, { status: 404 })
    if (actor.role === 'cashier' && order.employee_id !== actor.employeeId) {
      return Response.json({ error: 'Cashiers may record consent only for their own sales.' }, { status: 403 })
    }
    if (body.purpose === 'digital_payment_contact') {
      const { data: payment, error: paymentError } = await actor.admin.from('payments')
        .select('method,status').eq('store_id', actor.storeId).eq('order_id', order.id).maybeSingle()
      if (paymentError || !payment || !['card', 'momo'].includes(payment.method) || !['pending', 'initiated'].includes(payment.status)) {
        return Response.json({ error: 'Payment-contact consent is only recorded for an unconfirmed card or mobile-money request.' }, { status: 409 })
      }
    }
    const { error: consentError } = await actor.admin.from('privacy_consent_events').upsert({
      store_id: actor.storeId,
      order_id: order.id,
      employee_id: actor.employeeId,
      purpose_code: body.purpose,
      policy_version: PRIVACY_NOTICE_VERSION,
      consented_at: new Date().toISOString(),
    }, { onConflict: 'store_id,order_id,purpose_code,policy_version', ignoreDuplicates: true })
    if (consentError) throw new Error(`Privacy consent could not be recorded: ${consentError.message}`)
    return Response.json({ ok: true, recorded: true, purpose: body.purpose, policyVersion: PRIVACY_NOTICE_VERSION }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
