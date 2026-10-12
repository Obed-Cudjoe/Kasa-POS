import { authorizeRequest, routeError } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) throw new Error(`${label}: ${error.message}`)
  return data ?? []
}

export async function GET(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    const url = new URL(request.url)
    const cursor = url.searchParams.get('cursor')
    const since = cursor && Number.isFinite(Date.parse(cursor)) ? new Date(cursor).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString()
    const admin = actor.admin
    const { data: store, error: storeError } = await admin.from('stores').select('id,name').eq('id', actor.storeId).maybeSingle()
    if (storeError || !store) throw new Error(`Store profile: ${storeError?.message ?? 'not found'}`)

    const [categories, taxCategories, taxRates, products, inventory, employees, orders, shifts, dailyReports] = await Promise.all([
      rows(admin.from('categories').select('id,store_id,name,active,updated_at').eq('store_id', actor.storeId).limit(1000), 'Categories'),
      rows(admin.from('tax_categories').select('id,store_id,code,name,treatment,jurisdiction_code,default_price_mode,active,effective_from,effective_to').eq('store_id', actor.storeId).limit(500), 'Tax categories'),
      rows(admin.from('tax_rates').select('id,store_id,tax_category_id,component_code,component_name,rate_percent,calculation_method,calculation_order,effective_from,effective_to,active').eq('store_id', actor.storeId).eq('active', true).limit(1000), 'Tax rates'),
      rows(admin.from('products').select('id,store_id,category_id,tax_category_id,name,sku,barcode,unit_name,price_minor,currency_code,price_mode,tax_rate,active,row_version,created_at,updated_at').eq('store_id', actor.storeId).eq('active', true).order('updated_at', { ascending: true }).limit(1000), 'Products'),
      rows(admin.from('inventory').select('store_id,product_id,quantity_on_hand,row_version,updated_at').eq('store_id', actor.storeId).limit(1000), 'Inventory'),
      rows(admin.from('employees').select('id,store_id,auth_user_id,display_name,email,role,refund_limit_minor,status,created_at').eq('store_id', actor.storeId).in('status', ['active','invited']).limit(500), 'Employees'),
      rows(admin.from('orders').select('id,store_id,device_id,employee_id,shift_id,client_order_id,order_number,status,currency_code,subtotal_amount,tax_amount,total_amount,tax_snapshot,local_created_at,created_at,updated_at,paid_at').eq('store_id', actor.storeId).gte('updated_at', since).order('updated_at', { ascending: true }).limit(500), 'Orders'),
      rows(admin.from('shifts').select('id,store_id,device_id,employee_id,status,currency_code,opening_float,expected_cash,counted_cash,variance_amount,variance_reason,opened_at,closed_at').eq('store_id', actor.storeId).order('opened_at', { ascending: false }).limit(100), 'Shifts'),
      rows(admin.from('daily_reports').select('id,store_id,business_date,currency_code,gross_sales,refunds_total,net_sales,tax_total,tender_totals,tax_component_totals,generated_at').eq('store_id', actor.storeId).order('business_date', { ascending: false }).limit(90), 'Reports'),
    ])

    const orderIds = (orders as Array<{ id: string }>).map((order) => order.id)
    const [orderItems, payments, refunds, movements] = await Promise.all([
      orderIds.length ? rows(admin.from('order_items').select('id,store_id,order_id,product_id,product_name_snapshot,sku_snapshot,tax_category_name_snapshot,quantity,currency_code,price_mode,unit_price,line_subtotal,tax_rate,tax_amount,line_total,tax_snapshot').in('order_id', orderIds).limit(5000), 'Order lines') : [],
      orderIds.length ? rows(admin.from('payments').select('id,store_id,order_id,device_id,method,provider,provider_network,provider_reference,provider_transaction_id,idempotency_key,status,amount,currency_code,created_at,confirmed_at').in('order_id', orderIds).limit(1000), 'Payments') : [],
      orderIds.length ? rows(admin.from('refunds').select('id,store_id,order_id,payment_id,device_id,status,reason,amount,tax_amount,currency_code,provider_refund_id,created_at,processed_at').in('order_id', orderIds).limit(1000), 'Refunds') : [],
      rows(admin.from('inventory_movements').select('id,store_id,product_id,device_id,employee_id,movement_type,quantity_delta,base_inventory_version,order_id,refund_id,reason,occurred_at_device,created_at').eq('store_id', actor.storeId).gte('created_at', since).order('created_at', { ascending: true }).limit(2000), 'Stock movements'),
    ])
    const orderItemIds = (orderItems as Array<{ id: string }>).map((item) => item.id)
    const [itemTaxes, refundItems] = await Promise.all([
      orderItemIds.length ? rows(admin.from('order_item_taxes').select('store_id,order_item_id,component_code,component_name_snapshot,rate_percent,taxable_base_amount,tax_amount,calculation_method,calculation_order').in('order_item_id', orderItemIds).limit(5000), 'Tax snapshots') : [],
      (refunds as Array<{ id: string }>).length ? rows(admin.from('refund_items').select('store_id,refund_id,order_item_id,quantity,restock,item_amount,tax_amount').in('refund_id', (refunds as Array<{ id: string }>).map((refund) => refund.id)).limit(5000), 'Refund lines') : [],
    ])

    return Response.json({
      storeId: actor.storeId, store: { id: store.id, name: store.name }, serverTime: new Date().toISOString(), since,
      categories, taxCategories, taxRates, products, inventory, employees, orders,
      orderItems, itemTaxes, payments, refunds, refundItems, shifts, dailyReports, movements,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
