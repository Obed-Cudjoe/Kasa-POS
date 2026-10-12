import { authorizeRequest, routeError } from '@/lib/cloud'
import { paystackFetch, randomProviderReference } from '@/lib/paystack'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacy'
import { getWorkerEnv } from '@/lib/d1'

export const dynamic = 'force-dynamic'

const NETWORKS = new Set(['mtn', 'atl', 'vod'])

export async function POST(request: Request) {
  let requestReference: string | undefined
  try {
    const actor = await authorizeRequest(request)
    const env = await getWorkerEnv()
    const body = await request.json() as { orderId?: string; paymentId?: string; email?: string; phone?: string; network?: string }
    if (!body.orderId || !body.paymentId) return Response.json({ error: 'Missing order or payment reference.' }, { status: 400 })
    const { data: payment, error: paymentError } = await actor.admin.from('payments')
      .select('id,store_id,order_id,method,status,amount,currency_code,provider_reference,provider_network')
      .eq('store_id', actor.storeId).eq('id', body.paymentId).eq('order_id', body.orderId).maybeSingle()
    if (paymentError || !payment) return Response.json({ error: 'Pending payment was not found in cloud sync. Sync the pending sale, then retry.' }, { status: 409 })
    const method = payment.method === 'card' || payment.method === 'momo' ? payment.method : null
    const paymentStatus = typeof payment.status === 'string' ? payment.status : ''
    if (!method) return Response.json({ error: 'Only card or mobile-money payments can be initialized here.' }, { status: 400 })
    if (!['pending', 'initiated', 'failed'].includes(paymentStatus)) return Response.json({ error: 'This payment is not in a retryable state.' }, { status: 409 })
    const { data: order, error: orderError } = await actor.admin.from('orders')
      .select('id,employee_id,status,total_amount,currency_code,order_number').eq('store_id', actor.storeId).eq('id', body.orderId).maybeSingle()
    if (orderError || !order || order.status !== 'pending_payment' || Number(order.total_amount) !== Number(payment.amount)) {
      return Response.json({ error: 'Order totals do not match the pending payment. No charge was sent.' }, { status: 409 })
    }
    if (actor.role === 'cashier' && order.employee_id !== actor.employeeId) {
      return Response.json({ error: 'Cashiers may request payment only for their own sales.' }, { status: 403 })
    }
    if (paymentStatus !== 'failed' && payment.provider_reference) {
      return Response.json({ ok: true, method, reference: payment.provider_reference, providerStatus: paymentStatus, message: 'A provider request already uses this reference or may still be processing. No second charge request was sent; check provider status first.' }, { headers: { 'cache-control': 'no-store' } })
    }
    const { data: consent, error: consentError } = await actor.admin.from('privacy_consent_events').select('id')
      .eq('store_id', actor.storeId).eq('order_id', body.orderId)
      .eq('purpose_code', 'digital_payment_contact').eq('policy_version', PRIVACY_NOTICE_VERSION).maybeSingle()
    if (consentError || !consent) return Response.json({ error: 'Customer consent for payment-contact processing must be recorded before a provider request.' }, { status: 403 })
    const email = body.email?.trim() || env.PAYMENT_RECEIPT_EMAIL || env.PAYSTACK_DEFAULT_EMAIL
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'A valid customer email is required by the Paystack charge request.' }, { status: 400 })
    if (method === 'momo' && (!body.phone || !/^\+?[0-9]{9,15}$/.test(body.phone.replace(/[\s-]/g, '')) || !body.network || !NETWORKS.has(body.network))) {
      return Response.json({ error: 'Enter a valid mobile number and select MTN, ATMoney/Airtel Money, or Telecel.' }, { status: 400 })
    }
    const reference = randomProviderReference(method === 'momo' ? 'KASA-MOMO' : 'KASA-CARD')
    const { data: claim, error: claimError } = await actor.admin.from('payments').update({
      provider: 'paystack', provider_reference: reference,
      provider_network: method === 'momo' ? body.network : 'card',
      status: 'initiated', updated_at: new Date().toISOString(),
    }).eq('store_id', actor.storeId).eq('id', payment.id).eq('status', paymentStatus).select('id').maybeSingle()
    if (claimError) throw new Error(`Payment request could not be reserved: ${claimError.message}`)
    if (!claim) return Response.json({ error: 'Another request changed this payment. Refresh status before retrying.' }, { status: 409 })
    requestReference = reference
    const callbackOrigin = env.PUBLIC_APP_URL ? new URL(env.PUBLIC_APP_URL).origin : new URL(request.url).origin
    const callback = `${callbackOrigin}/?payment=return&order=${encodeURIComponent(body.orderId)}&reference=${encodeURIComponent(reference)}`
    const metadata = { store_id: actor.storeId, order_id: body.orderId, payment_id: payment.id, order_number: order.order_number, source: 'kasa-pos' }
    let providerResponse: Record<string, unknown>
    if (method === 'momo') {
      providerResponse = await paystackFetch('/charge', {
        method: 'POST',
        body: JSON.stringify({
          email, amount: Number(payment.amount), currency: payment.currency_code, reference,
          mobile_money: { phone: body.phone!.replace(/[\s-]/g, ''), provider: body.network }, metadata,
        }),
      })
    } else {
      providerResponse = await paystackFetch('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email, amount: Number(payment.amount), currency: payment.currency_code,
          reference, callback_url: callback, channels: ['card'], metadata,
        }),
      })
    }
    const data = providerResponse.data as Record<string, unknown> | undefined
    const status = typeof data?.status === 'string' ? data.status : 'pending'
    const { data: pendingSaved, error: updateError } = await actor.admin.from('payments').update({
      status: 'pending', updated_at: new Date().toISOString(),
    }).eq('store_id', actor.storeId).eq('id', payment.id).eq('status', 'initiated').eq('provider_reference', reference).select('id').maybeSingle()
    if (updateError) return Response.json({ error: `Provider was contacted but the POS could not save the pending status. Contact support with ${reference}.`, reference }, { status: 502 })
    if (!pendingSaved) {
      const { data: currentPayment, error: currentError } = await actor.admin.from('payments').select('status').eq('store_id', actor.storeId).eq('id', payment.id).maybeSingle()
      if (currentError || currentPayment?.status !== 'confirmed') return Response.json({ error: `Payment state changed while Paystack was processing. Check status before retrying; reference ${reference}.`, reference }, { status: 409 })
    }
    const { error: orderUpdateError } = await actor.admin.from('orders').update({ updated_at: new Date().toISOString() }).eq('store_id', actor.storeId).eq('id', body.orderId)
    if (orderUpdateError) return Response.json({ error: `Payment reference ${reference} was saved, but order sync needs a refresh: ${orderUpdateError.message}`, reference }, { status: 502 })

    return Response.json({
      ok: true, method, reference, providerStatus: status,
      authorizationUrl: typeof data?.authorization_url === 'string' ? data.authorization_url : undefined,
      displayText: typeof data?.display_text === 'string' ? data.display_text : undefined,
      message: typeof providerResponse.message === 'string' ? providerResponse.message : 'Payment request sent. Wait for provider confirmation.',
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) {
      return Response.json({ error: `Payment request timed out. It may still be processing. Do not create a second sale; check status using reference ${requestReference ?? 'saved in the POS'}.`, reference: requestReference }, { status: 504 })
    }
    if (requestReference) return Response.json({ error: `${error instanceof Error ? error.message : 'Provider request failed.'} A request may already exist. Check status using reference ${requestReference} before retrying.`, reference: requestReference }, { status: 502 })
    return routeError(error)
  }
}
