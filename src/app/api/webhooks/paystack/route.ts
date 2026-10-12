import { createHash } from 'node:crypto'
import { createAdminClient, routeError } from '@/lib/cloud'
import { verifyPaystackSignature } from '@/lib/paystack'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-paystack-signature')
  if (!await verifyPaystackSignature(rawBody, signature)) return Response.json({ error: 'Invalid webhook signature.' }, { status: 401 })
  try {
    const payload = JSON.parse(rawBody) as { event?: string; data?: Record<string, unknown> }
    const eventType = String(payload.event ?? 'unknown')
    const data = payload.data ?? {}
    const reference = String(data.reference ?? '')
    const providerId = String(data.id ?? '')
    const eventId = `${eventType}:${providerId || reference || createHash('sha256').update(rawBody).digest('hex').slice(0, 24)}`
    const admin = createAdminClient()
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    const { data: alreadySeen } = await admin.from('payment_webhook_events').select('id').eq('provider', 'paystack').eq('provider_event_id', eventId).maybeSingle()
    if (alreadySeen) return Response.json({ received: true, duplicate: true }, { status: 200 })

    let storeId: string | null = null
    let paymentId: string | null = null
    let processingStatus: 'processed' | 'ignored' | 'failed' = 'ignored'

    if (['charge.success', 'transaction.success'].includes(eventType)) {
      if (!reference || String(data.status) !== 'success') throw new Error('Webhook success event is missing a successful reference.')
      const { data: payment, error } = await admin.from('payments').select('id,store_id,amount,currency_code')
        .eq('provider', 'paystack').eq('provider_reference', reference).maybeSingle()
      if (error || !payment) throw new Error('Verified Paystack reference is not linked to a POS payment.')
      storeId = typeof payment.store_id === 'string' ? payment.store_id : null
      paymentId = typeof payment.id === 'string' ? payment.id : null
      if (!storeId || !paymentId) throw new Error('Linked POS payment is missing its store or payment ID.')
      const { error: confirmError } = await admin.rpc('confirm_paystack_payment', {
        p_reference: reference,
        p_amount: Number(data.amount),
        p_currency: String(data.currency ?? ''),
        p_transaction_id: providerId,
      })
      if (confirmError) throw new Error(confirmError.message)
      processingStatus = 'processed'
    } else if (eventType.startsWith('refund.')) {
      const refundId = providerId
      const transactionValue = data.transaction
      const transactionReference = typeof transactionValue === 'string' ? transactionValue
        : transactionValue && typeof transactionValue === 'object' ? String((transactionValue as Record<string, unknown>).reference ?? '') : ''
      const { data: byProviderId, error: lookupError } = await admin.from('refunds').select('id,store_id,payment_id,order_id,amount,currency_code')
        .eq('provider_refund_id', refundId).maybeSingle()
      if (lookupError) return Response.json({ error: 'Refund lookup was inconclusive; retry delivery.' }, { status: 503 })
      let refund = byProviderId
      if (!refund && transactionReference && data.amount !== undefined && typeof data.currency === 'string') {
        const { data: byTransaction, error: fallbackError } = await admin.from('refunds').select('id,store_id,payment_id,order_id,amount,currency_code')
          .eq('provider_reference', transactionReference).eq('amount', Number(data.amount)).eq('currency_code', data.currency)
          .in('status', ['pending', 'processing', 'needs_attention']).maybeSingle()
        if (fallbackError) return Response.json({ error: 'Refund fallback lookup was ambiguous; reconcile manually and retry delivery.' }, { status: 503 })
        refund = byTransaction
      }
      if (!refund) {
        // A signed provider event can arrive after the request timed out before its refund ID was saved.
        // The transaction/amount/currency fallback above links only one unambiguous pending record.
        return Response.json({ error: 'Refund reference is not linked yet; retry delivery.' }, { status: 503 })
      }
      const refundIdLocal = typeof refund.id === 'string' ? refund.id : ''
      const refundStoreId = typeof refund.store_id === 'string' ? refund.store_id : ''
      const refundPaymentId = typeof refund.payment_id === 'string' ? refund.payment_id : ''
      const refundOrderId = typeof refund.order_id === 'string' ? refund.order_id : ''
      if (!refundIdLocal || !refundStoreId || !refundPaymentId || !refundOrderId) throw new Error('Linked POS refund is missing required store, order, payment or refund IDs.')
      if (data.amount !== undefined && Number(data.amount) !== Number(refund.amount)) throw new Error('Paystack refund webhook amount differs from the saved POS refund.')
      if (typeof data.currency === 'string' && data.currency !== refund.currency_code) throw new Error('Paystack refund webhook currency differs from the saved POS refund.')
      storeId = refundStoreId
      paymentId = refundPaymentId
      const isSuccess = eventType === 'refund.processed' || String(data.status) === 'processed'
      const isFailure = eventType === 'refund.failed' || String(data.status) === 'failed'
      const nextStatus = isSuccess ? 'processed' : isFailure ? 'failed' : 'processing'
      const { error: refundUpdateError } = await admin.from('refunds').update({ provider_refund_id: refundId || null, status: nextStatus, processed_at: isSuccess ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('store_id', refundStoreId).eq('id', refundIdLocal)
      if (refundUpdateError) throw new Error(`Refund status could not be saved: ${refundUpdateError.message}`)
      if (isSuccess || isFailure) {
        const { data: related, error: relatedError } = await admin.from('refunds').select('amount,status').eq('store_id', refundStoreId).eq('order_id', refundOrderId)
        if (relatedError) throw new Error(`Refund status saved, but related totals could not be read: ${relatedError.message}`)
        const refundProjection = (related ?? []) as Array<{ amount: number; status: string }>
        const processed = refundProjection.filter((row) => row.status === 'processed').reduce((sum, row) => sum + Number(row.amount), 0)
        const hasPending = refundProjection.some((row) => ['pending', 'processing', 'requested', 'needs_attention'].includes(row.status))
        const { data: order, error: orderError } = await admin.from('orders').select('total_amount').eq('store_id', refundStoreId).eq('id', refundOrderId).maybeSingle()
        if (orderError || !order) throw new Error(`Refund status saved, but the original order could not be read: ${orderError?.message ?? 'order not found'}`)
        const orderStatus = processed >= Number(order.total_amount) ? 'refunded' : processed > 0 || hasPending ? 'partially_refunded' : 'paid'
        const { error: orderUpdateError } = await admin.from('orders').update({ status: orderStatus, updated_at: new Date().toISOString() }).eq('store_id', refundStoreId).eq('id', refundOrderId)
        const { error: paymentUpdateError } = await admin.from('payments').update({ status: orderStatus === 'refunded' ? 'refunded' : processed > 0 ? 'partially_refunded' : 'confirmed', updated_at: new Date().toISOString() })
          .eq('store_id', refundStoreId).eq('id', refundPaymentId)
        if (orderUpdateError || paymentUpdateError) throw new Error(`Refund status saved, but order/payment projections need reconciliation: ${orderUpdateError?.message ?? paymentUpdateError?.message}`)
      }
      processingStatus = isSuccess || isFailure ? 'processed' : 'ignored'
    }

    const { error: insertError } = await admin.from('payment_webhook_events').insert({
      provider: 'paystack', provider_event_id: eventId, store_id: storeId, payment_id: paymentId,
      event_type: eventType, payload_hash: bodyHash, signature_verified: true,
      processing_status: processingStatus, processed_at: new Date().toISOString(),
    })
    if (insertError && !/duplicate|unique/i.test(insertError.message)) throw new Error(insertError.message)
    return Response.json({ received: true, processed: processingStatus === 'processed' }, { status: 200 })
  } catch (error) {
    const response = routeError(error)
    // Provider webhooks should be retried on transient cloud/database failures.
    if (response.status >= 500) return response
    return Response.json({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }, { status: 500 })
  }
}
