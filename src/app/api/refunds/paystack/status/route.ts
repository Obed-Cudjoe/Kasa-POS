import { authorizeRequest, routeError } from '@/lib/cloud'
import { paystackFetch } from '@/lib/paystack'

export const dynamic = 'force-dynamic'

async function updateRefundProjection(admin: ReturnType<typeof import('@/lib/cloud').createAdminClient>, storeId: string, orderId: string, paymentId: string) {
  const { data: refunds, error: refundError } = await admin.from('refunds').select('amount,status').eq('store_id', storeId).eq('order_id', orderId)
  if (refundError) throw new Error(`Could not read refund totals: ${refundError.message}`)
  const confirmed = (refunds ?? []).filter((refund) => refund.status === 'processed').reduce((sum, refund) => sum + Number(refund.amount), 0)
  const hasPending = (refunds ?? []).some((refund) => ['pending', 'processing', 'requested', 'needs_attention'].includes(refund.status))
  const { data: order, error: orderError } = await admin.from('orders').select('total_amount').eq('store_id', storeId).eq('id', orderId).maybeSingle()
  if (orderError || !order) throw new Error(`Could not read the original order: ${orderError?.message ?? 'order not found'}`)
  const orderStatus = confirmed >= Number(order.total_amount) ? 'refunded' : confirmed > 0 || hasPending ? 'partially_refunded' : 'paid'
  const { error: orderUpdateError } = await admin.from('orders').update({ status: orderStatus, updated_at: new Date().toISOString() }).eq('store_id', storeId).eq('id', orderId)
  const { error: paymentUpdateError } = await admin.from('payments').update({ status: orderStatus === 'refunded' ? 'refunded' : orderStatus === 'partially_refunded' && confirmed > 0 ? 'partially_refunded' : 'confirmed', updated_at: new Date().toISOString() }).eq('store_id', storeId).eq('id', paymentId)
  if (orderUpdateError || paymentUpdateError) throw new Error(`Could not update order/payment status: ${orderUpdateError?.message ?? paymentUpdateError?.message}`)
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request, ['owner', 'manager'])
    const body = await request.json() as { refundId?: string }
    if (!body.refundId) return Response.json({ error: 'Refund ID is required.' }, { status: 400 })
    const { data: refund, error } = await actor.admin.from('refunds')
      .select('id,store_id,order_id,payment_id,amount,currency_code,provider_refund_id,status')
      .eq('store_id', actor.storeId).eq('id', body.refundId).maybeSingle()
    if (error || !refund) return Response.json({ error: 'Refund record was not found in the store cloud.' }, { status: 404 })
    if (!refund.provider_refund_id) return Response.json({ error: 'No Paystack refund ID has been saved yet. Sync the refund and submit the original-tender reversal first.' }, { status: 409 })

    const response = await paystackFetch('/refund?perPage=100&page=1', { method: 'GET' })
    const rows = Array.isArray(response.data) ? response.data as Array<Record<string, unknown>> : []
    const providerRefund = rows.find((item) => String(item.id) === String(refund.provider_refund_id))
    if (!providerRefund) return Response.json({ error: 'Refund was not found in the latest Paystack refund list. Check the provider dashboard; no local success was assumed.' }, { status: 404 })
    if (Number(providerRefund.amount) !== Number(refund.amount) || String(providerRefund.currency ?? refund.currency_code) !== refund.currency_code) {
      return Response.json({ error: 'Paystack refund amount/currency differs from the POS refund. Status was not changed.' }, { status: 409 })
    }
    const providerStatus = String(providerRefund.status ?? 'pending').toLowerCase()
    const status = providerStatus === 'processed' ? 'processed' : providerStatus === 'failed' ? 'failed' : 'processing'
    const { error: updateError } = await actor.admin.from('refunds').update({
      status, processed_at: status === 'processed' ? (providerRefund.refunded_at ? String(providerRefund.refunded_at) : new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }).eq('store_id', actor.storeId).eq('id', refund.id)
    if (updateError) throw new Error(updateError.message)
    await updateRefundProjection(actor.admin, actor.storeId, refund.order_id, refund.payment_id)
    return Response.json({ ok: true, status, providerStatus, providerRefundId: refund.provider_refund_id, message: providerStatus === 'processed' ? 'Paystack reports processed. Customer bank/mobile-money timing may still take several days.' : `Paystack reports ${providerStatus}; refund is not complete.` }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
