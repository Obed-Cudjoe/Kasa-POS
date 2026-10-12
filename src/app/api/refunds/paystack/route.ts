import { authorizeRequest, routeError } from '@/lib/cloud'
import { isWithinRefundLimit } from '@/lib/permissions'
import { paystackFetch } from '@/lib/paystack'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const body = await request.json() as { refundId?: string }
    if (!body.refundId) return Response.json({ error: 'Refund ID is required.' }, { status: 400 })
    const { data: refund, error: refundError } = await actor.admin.from('refunds')
      .select('id,store_id,order_id,payment_id,requested_by,status,reason,amount,currency_code,provider_refund_id')
      .eq('store_id', actor.storeId).eq('id', body.refundId).maybeSingle()
    if (refundError || !refund) return Response.json({ error: 'Refund is not synced to the store cloud yet. Keep it pending and retry after sync.' }, { status: 409 })
    const refundStatus = typeof refund.status === 'string' ? refund.status : ''
    const savedProviderRefundId = typeof refund.provider_refund_id === 'string' ? refund.provider_refund_id : ''
    if (actor.role === 'cashier' && refund.requested_by !== actor.employeeId) {
      return Response.json({ error: 'Cashiers may submit only refunds attributed to their own profile.' }, { status: 403 })
    }
    if (['processed', 'processing'].includes(refundStatus) && savedProviderRefundId) {
      return Response.json({ ok: true, status: refundStatus, providerRefundId: savedProviderRefundId, duplicate: true })
    }
    if (refundStatus === 'processing' || refundStatus === 'needs_attention') {
      return Response.json({ error: 'This refund may already have reached Paystack. Reconcile its status in the provider dashboard; do not submit it again.' }, { status: 409 })
    }
    if (refundStatus !== 'pending') return Response.json({ error: 'Only a pending refund request can be submitted. For a failed attempt, create a new request after reconciliation.' }, { status: 409 })
    if (!isWithinRefundLimit(Number(refund.amount), actor.refundLimitMinor)) {
      return Response.json({ error: 'Refund exceeds this employee’s configured authorization limit.' }, { status: 403 })
    }
    const { data: payment, error: paymentError } = await actor.admin.from('payments')
      .select('id,method,provider,provider_reference,provider_transaction_id,amount,currency_code,status')
      .eq('store_id', actor.storeId).eq('id', refund.payment_id).maybeSingle()
    if (paymentError || !payment) return Response.json({ error: 'Original tender payment could not be found.' }, { status: 409 })
    const tenderMethod = payment.method === 'card' || payment.method === 'momo' ? payment.method : null
    const paymentStatus = typeof payment.status === 'string' ? payment.status : ''
    const paymentCurrency = typeof payment.currency_code === 'string' ? payment.currency_code : ''
    const refundCurrency = typeof refund.currency_code === 'string' ? refund.currency_code : ''
    if (!tenderMethod || payment.provider !== 'paystack') return Response.json({ error: 'Original tender does not support a Paystack digital reversal.' }, { status: 409 })
    if (!['confirmed', 'partially_refunded'].includes(paymentStatus)) return Response.json({ error: 'Original payment has not been provider-confirmed.' }, { status: 409 })
    const transaction = typeof payment.provider_transaction_id === 'string' && payment.provider_transaction_id
      ? payment.provider_transaction_id : typeof payment.provider_reference === 'string' ? payment.provider_reference : ''
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
    const providerCurrency = typeof data?.currency === 'string' ? data.currency : paymentCurrency
    const amountMismatch = providerAmount !== null && (!Number.isFinite(providerAmount) || providerAmount !== Number(refund.amount))
    const currencyMismatch = providerCurrency !== paymentCurrency || refundCurrency !== paymentCurrency
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
      const refundProjection = (refundRows ?? []) as Array<{ amount: number; status: string }>
      const confirmed = refundProjection.filter((row) => row.status === 'processed').reduce((sum, row) => sum + Number(row.amount), 0)
      const hasPending = refundProjection.some((row) => ['pending', 'processing', 'requested', 'needs_attention'].includes(row.status))
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
