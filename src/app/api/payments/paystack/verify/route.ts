import { authorizeRequest, routeError } from '@/lib/cloud'
import { paystackFetch } from '@/lib/paystack'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const body = await request.json() as { reference?: string; orderId?: string }
    const reference = body.reference?.trim()
    if (!reference || !body.orderId) return Response.json({ error: 'Payment reference and order ID are required.' }, { status: 400 })
    const { data: payment, error } = await actor.admin.from('payments')
      .select('id,store_id,order_id,method,status,amount,currency_code,provider_reference')
      .eq('store_id', actor.storeId).eq('order_id', body.orderId).eq('provider', 'paystack').eq('provider_reference', reference).maybeSingle()
    if (error || !payment) return Response.json({ error: 'The reference is not linked to this store/order.' }, { status: 404 })
    const { data: order, error: orderError } = await actor.admin.from('orders').select('employee_id')
      .eq('store_id', actor.storeId).eq('id', payment.order_id).maybeSingle()
    if (orderError || !order) return Response.json({ error: 'The original sale was not found in this store.' }, { status: 404 })
    if (actor.role === 'cashier' && order.employee_id !== actor.employeeId) {
      return Response.json({ error: 'Cashiers may verify only their own sales.' }, { status: 403 })
    }
    const result = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
    const data = result.data as Record<string, unknown> | undefined
    const status = typeof data?.status === 'string' ? data.status : 'unknown'
    const verifiedReference = String(data?.reference ?? '')
    const verifiedAmount = Number(data?.amount)
    const verifiedCurrency = String(data?.currency ?? '')
    const metadata = data?.metadata as Record<string, unknown> | undefined
    const metadataMatches = !metadata || (
      String(metadata.payment_id ?? payment.id) === payment.id &&
      String(metadata.order_id ?? payment.order_id) === payment.order_id &&
      String(metadata.store_id ?? actor.storeId) === actor.storeId
    )
    if (status !== 'success') {
      if (['failed', 'abandoned'].includes(status)) {
        const failedAt = new Date().toISOString()
        const { error: updateError } = await actor.admin.from('payments').update({ status: 'failed', updated_at: failedAt })
          .eq('store_id', actor.storeId).eq('id', payment.id).eq('status', 'pending')
        if (updateError) throw new Error(`Provider reported ${status}, but payment state could not be saved: ${updateError.message}`)
        const { error: orderUpdateError } = await actor.admin.from('orders').update({ updated_at: failedAt }).eq('store_id', actor.storeId).eq('id', payment.order_id)
        if (orderUpdateError) throw new Error(`Provider reported ${status}; payment is saved but order sync needs a refresh: ${orderUpdateError.message}`)
      }
      return Response.json({ ok: true, paid: false, providerStatus: status, message: 'Provider has not confirmed payment. Keep the sale pending; do not hand over goods until confirmation.' }, { headers: { 'cache-control': 'no-store' } })
    }
    if (verifiedReference !== reference || verifiedAmount !== Number(payment.amount) || verifiedCurrency !== payment.currency_code || !metadataMatches) {
      return Response.json({ error: 'Verified provider data does not match the POS order. The sale remains unpaid; contact support.' }, { status: 409 })
    }
    const transactionId = String(data?.id ?? '')
    const { data: confirmation, error: confirmError } = await actor.admin.rpc('confirm_paystack_payment', {
      p_reference: reference,
      p_amount: verifiedAmount,
      p_currency: verifiedCurrency,
      p_transaction_id: transactionId,
    })
    if (confirmError) throw new Error(`Payment verified by Paystack but POS finalization needs attention (${reference}): ${confirmError.message}`)
    return Response.json({ ok: true, paid: true, reference, transactionId, confirmation }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
