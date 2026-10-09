import { authorizeRequest, routeError } from '@/lib/cloud'
import { paystackFetch } from '@/lib/paystack'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner', 'manager'])
    const body = await request.json() as { refundId?: string }
    if (!body.refundId) return Response.json({ error: 'Refund ID is required.' }, { status: 400 })
    const { data: refund, error: refundError } = await actor.admin.from('refunds')
      .select('id,store_id,order_id,payment_id,status,reason,amount,currency_code,provider_refund_id')
      .eq('store_id', actor.storeId).eq('id', body.refundId).maybeSingle()
    if (refundError || !refund) return Response.json({ error: 'Refund is not synced to the store cloud yet. Keep it pending and retry after sync.' }, { status: 409 })
    if (['processed', 'processing'].includes(refund.status) && refund.provider_refund_id) {
      return Response.json({ ok: true, status: refund.status, providerRefundId: refund.provider_refund_id, duplicate: true })
    }
    if (refund.status === 'processing' || refund.status === 'needs_attention') {
      return Response.json({ error: 'This refund may already have reached Paystack. Reconcile its status in the provider dashboard; do not submit it again.' }, { status: 409 })
    }
    if (refund.status !== 'pending') return Response.json({ error: 'Only a pending refund request can be submitted. For a failed attempt, create a new request after reconciliation.' }, { status: 409 })
    const { data: payment, error: paymentError } = await actor.admin.from('payments')
      .select('id,method,provider,provider_reference,provider_transaction_id,amount,currency_code,status')
      .eq('store_id', actor.storeId).eq('id', refund.payment_id).maybeSingle()
    if (paymentError || !payment) return Response.json({ error: 'Original tender payment could not be found.' }, { status: 409 })
    if (!['card', 'momo'].includes(payment.method) || payment.provider !== 'paystack') return Response.json({ error: 'Original tender does not support a Paystack digital reversal.' }, { status: 409 })
    if (!['confirmed', 'partially_refunded'].includes(payment.status)) return Response.json({ error: 'Original payment has not been provider-confirmed.' }, { status: 409 })
    const transaction = payment.provider_transaction_id || payment.provider_reference
    if (!transaction) return Response.json({ error: 'Provider transaction reference is missing.' }, { status: 409 })
    const { data: claim, error: claimError } = await actor.admin.from('refunds')
      .update({ status: 'processing', provider_reference: transaction, updated_at: new Date().toISOString() })
      .eq('store_id', actor.storeId).eq('id', refund.id).eq('status', 'pending').select('id').maybeSingle()
    if (claimError) throw new Error(`Refund could not be locked for provider submission: ${claimError.message}`)
    if (!claim) return Response.json({ error: 'Another request may already be submitting this refund. Check its status; do not submit it again.' }, { status: 409 })

    let response: Awaited<ReturnType<typeof paystackFetch>>
    try {
      response = await paystackFetch('/refund', {
        method: 'POST',
        body: JSON.stringify({ transaction, amount: Number(refund.amount), customer_note: refund.reason }),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'provider request failed'
      const { error: markError } = await actor.admin.from('refunds').update({ status: 'needs_attention', updated_at: new Date().toISOString() }).eq('store_id', actor.storeId).eq('id', refund.id)
      return Response.json({ error: `${detail}. Refund is marked needs_attention; reconcile in Paystack before any retry.${markError ? ` Cloud note: ${markError.message}` : ''}` }, { status: 504 })
    }
    const data = response.data as Record<string, unknown> | undefined
    const providerRefundId = data?.id !== undefined ? String(data.id) : ''
    const providerStatus = String(data?.status ?? 'pending').toLowerCase()
    const providerAmount = data?.amount === undefined ? null : Number(data.amount)
    const providerCurrency = typeof data?.currency === 'string' ? data.currency : payment.currency_code
    const amountMismatch = providerAmount !== null && (!Number.isFinite(providerAmount) || providerAmount !== Number(refund.amount))
    const currencyMismatch = providerCurrency !== payment.currency_code || refund.currency_code !== payment.currency_code
    if (!providerRefundId || amountMismatch || currencyMismatch) {
      const { error: noteError } = await actor.admin.from('refunds').update({
        provider_refund_id: providerRefundId || null, provider_reference: String(data?.transaction ?? transaction),
        status: 'needs_attention', updated_at: new Date().toISOString(),
      }).eq('store_id', actor.storeId).eq('id', refund.id)
      const reason = !providerRefundId ? 'Paystack accepted or responded without a refund ID.' : amountMismatch ? 'Paystack refund amount differs from the POS request.' : 'Paystack refund currency differs from the original tender.'
      return Response.json({ error: `${reason} The refund is marked needs_attention; reconcile in Paystack before any retry.${noteError ? ` Cloud note: ${noteError.message}` : ''}` }, { status: 502 })
    }
    const status = providerStatus === 'processed' ? 'processed' : providerStatus === 'failed' ? 'failed' : 'processing'
    const { error: updateError } = await actor.admin.from('refunds').update({
      provider_refund_id: providerRefundId || null,
      provider_reference: String(data?.transaction ?? transaction),
      status,
      processed_at: status === 'processed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('store_id', actor.storeId).eq('id', refund.id)
    if (updateError) return Response.json({ error: `Provider accepted the reversal, but POS could not save it. Contact support with refund ${refund.id}.` }, { status: 502 })
    if (status === 'processed' || status === 'failed') {
      const { data: refundRows, error: rowsError } = await actor.admin.from('refunds').select('amount,status').eq('store_id', actor.storeId).eq('order_id', refund.order_id)
      if (rowsError) return Response.json({ error: `Refund status was saved, but order totals need reconciliation: ${rowsError.message}` }, { status: 502 })
      const confirmed = (refundRows ?? []).filter((row) => row.status === 'processed').reduce((sum, row) => sum + Number(row.amount), 0)
      const hasPending = (refundRows ?? []).some((row) => ['pending', 'processing', 'requested', 'needs_attention'].includes(row.status))
      const { data: order, error: orderError } = await actor.admin.from('orders').select('total_amount').eq('store_id', actor.storeId).eq('id', refund.order_id).maybeSingle()
      if (orderError || !order) return Response.json({ error: `Refund status was saved, but the original order projection needs reconciliation: ${orderError?.message ?? 'order not found'}` }, { status: 502 })
      const orderStatus = confirmed >= Number(order.total_amount) ? 'refunded' : confirmed > 0 || hasPending ? 'partially_refunded' : 'paid'
      const { error: orderUpdateError } = await actor.admin.from('orders').update({ status: orderStatus, updated_at: new Date().toISOString() }).eq('store_id', actor.storeId).eq('id', refund.order_id)
      const { error: paymentUpdateError } = await actor.admin.from('payments').update({ status: orderStatus === 'refunded' ? 'refunded' : orderStatus === 'partially_refunded' && confirmed > 0 ? 'partially_refunded' : 'confirmed', updated_at: new Date().toISOString() }).eq('store_id', actor.storeId).eq('id', refund.payment_id)
      if (orderUpdateError || paymentUpdateError) return Response.json({ error: `Refund status was saved, but order/payment projections need reconciliation: ${orderUpdateError?.message ?? paymentUpdateError?.message}` }, { status: 502 })
    }
    return Response.json({ ok: true, status, providerStatus, providerRefundId, message: 'Provider refund is not final until Paystack status is verified or a signed refund webhook is received.' }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
