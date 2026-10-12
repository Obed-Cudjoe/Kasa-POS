'use client'

import { db, getMeta, setMeta } from './local-db'
import type { CalculatedLine, Employee, InventoryMovement, Order, Payment, Product, Refund, RefundStatus, Shift, SyncEvent, TaxCategory, TaxLine } from './types'

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : value == null ? fallback : String(value)
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const arr = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value as Array<Record<string, unknown>> : []
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : new Date().toISOString()

export async function pushOutbox() {
  const events = await db.syncOutbox.where('status').equals('pending').toArray()
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let sent = 0
  const conflicts: string[] = []
  for (let start = 0; start < events.length; start += 50) {
    const batch = events.slice(start, start + 50)
    const response = await fetch('/api/sync/push', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ events: batch }), cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; results?: Array<{ eventId: string; status: string; error?: string }> }
    if (!response.ok) throw new Error(payload.error || `Sync failed (${response.status}).`)
    const results = new Map((payload.results ?? []).map((result) => [result.eventId, result]))
    for (const event of batch) {
      const result = results.get(event.eventId)
      if (result?.status === 'accepted') {
        await markEventSynced(event)
        sent += 1
      } else if (result?.status === 'conflict' || result?.status === 'rejected') {
        const message = result.error || 'Server marked this event for review.'
        await db.syncOutbox.update(event.eventId, { status: 'conflict', lastError: message })
        await markEntityConflict(event)
        conflicts.push(message)
      }
    }
  }
  return { sent, pending: await db.syncOutbox.where('status').equals('pending').count(), conflicts, configured: true }
}

async function markEventSynced(event: SyncEvent) {
  await db.syncOutbox.update(event.eventId, { status: 'synced', lastError: undefined })
  if (event.eventType === 'order') {
    const order = await db.orders.get(event.entityId)
    if (order) await db.orders.update(event.entityId, { syncStatus: 'synced' })
    const payload = event.payload as { inventoryMovements?: InventoryMovement[] }
    if (payload.inventoryMovements?.length) await db.inventoryMovements.where('orderId').equals(event.entityId).modify({ syncStatus: 'synced' })
  } else if (event.eventType === 'refund') {
    await db.refunds.update(event.entityId, { syncStatus: 'synced' })
    await db.inventoryMovements.where('refundId').equals(event.entityId).modify({ syncStatus: 'synced' })
  } else if (event.eventType === 'inventory_movement') {
    await db.inventoryMovements.update(event.entityId, { syncStatus: 'synced' })
  } else if (event.eventType === 'shift') {
    await db.shifts.update(event.entityId, { syncStatus: 'synced' })
  }
}

async function markEntityConflict(event: SyncEvent) {
  if (event.eventType === 'order') await db.orders.update(event.entityId, { syncStatus: 'conflict' })
  else if (event.eventType === 'refund') await db.refunds.update(event.entityId, { syncStatus: 'conflict' })
  else if (event.eventType === 'inventory_movement') await db.inventoryMovements.update(event.entityId, { syncStatus: 'conflict' })
  else if (event.eventType === 'shift') await db.shifts.update(event.entityId, { syncStatus: 'conflict' })
}

export async function pullCloud() {
  const cursor = await getMeta<string | null>('cloud-pull-cursor', null)
  const endpoint = `/api/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
  const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Cloud pull failed (${response.status}).`)
  const categoryRows = arr(payload.categories)
  const taxRows = arr(payload.taxCategories)
  const rateRows = arr(payload.taxRates)
  const productRows = arr(payload.products)
  const inventoryRows = arr(payload.inventory)
  const employeeRows = arr(payload.employees)
  const orderRows = arr(payload.orders)
  const itemRows = arr(payload.orderItems)
  const taxItemRows = arr(payload.itemTaxes)
  const paymentRows = arr(payload.payments)
  const refundRows = arr(payload.refunds)
  const refundItemRows = arr(payload.refundItems)
  const shiftRows = arr(payload.shifts)
  const movementRows = arr(payload.movements)

  const categoryNames = new Map(categoryRows.map((row) => [text(row.id), text(row.name, 'General')]))
  const taxRatesByCategory = new Map<string, Array<Record<string, unknown>>>()
  for (const rate of rateRows) {
    const id = text(rate.tax_category_id)
    taxRatesByCategory.set(id, [...(taxRatesByCategory.get(id) ?? []), rate])
  }
  const taxCategories: TaxCategory[] = taxRows.map((row) => ({
    id: text(row.id), storeId: text(row.store_id), code: text(row.code), name: text(row.name),
    treatment: text(row.treatment, 'standard_rated') as TaxCategory['treatment'],
    defaultPriceMode: text(row.default_price_mode, 'inclusive') as TaxCategory['defaultPriceMode'],
    effectiveFrom: text(row.effective_from, new Date().toISOString().slice(0, 10)), active: Boolean(row.active),
    components: (taxRatesByCategory.get(text(row.id)) ?? []).map((rate) => ({
      id: text(rate.id), code: text(rate.component_code), name: text(rate.component_name),
      ratePercent: number(rate.rate_percent), method: text(rate.calculation_method, 'same_base') as 'same_base' | 'compound',
      order: number(rate.calculation_order, 1),
    })),
  }))
  const employees: Employee[] = employeeRows.map((row) => ({
    id: text(row.id), storeId: text(row.store_id), authUserId: text(row.auth_user_id) || undefined,
    displayName: text(row.display_name), email: text(row.email) || undefined, role: text(row.role, 'cashier') as Employee['role'],
    refundLimitMinor: row.refund_limit_minor == null ? null : number(row.refund_limit_minor),
    status: text(row.status) === 'disabled' ? 'disabled' : text(row.status) === 'invited' ? 'invited' : 'active', createdAt: iso(row.created_at),
  }))
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.displayName]))
  const products: Product[] = productRows.map((row) => ({
    id: text(row.id), storeId: text(row.store_id), name: text(row.name), sku: text(row.sku), barcode: text(row.barcode) || undefined,
    categoryId: text(row.category_id), categoryName: categoryNames.get(text(row.category_id)) ?? 'General',
    taxCategoryId: text(row.tax_category_id), priceMinor: number(row.price_minor),
    currencyCode: text(row.currency_code, 'GHS'), priceMode: text(row.price_mode, 'inclusive') as Product['priceMode'],
    taxRateOverride: row.tax_rate == null ? null : number(row.tax_rate), unitName: text(row.unit_name, 'each'),
    active: Boolean(row.active), rowVersion: number(row.row_version, 1),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }))
  const productIds = new Set(products.map((product) => product.id))
  const inventory = inventoryRows.filter((row) => productIds.has(text(row.product_id))).map((row) => ({
    storeId: text(row.store_id), productId: text(row.product_id), quantityOnHand: number(row.quantity_on_hand),
    rowVersion: number(row.row_version, 1), updatedAt: iso(row.updated_at),
  }))
  const paymentByOrder = new Map<string, Payment>()
  const payments: Payment[] = paymentRows.map((row) => {
    const payment: Payment = {
      id: text(row.id), orderId: text(row.order_id), storeId: text(row.store_id), deviceId: text(row.device_id),
      method: text(row.method, 'cash') as Payment['method'], status: text(row.status, 'pending') as Payment['status'],
      amountMinor: number(row.amount), currencyCode: text(row.currency_code, 'GHS'),
      provider: text(row.provider) as Payment['provider'], providerNetwork: text(row.provider_network) || undefined,
      providerReference: text(row.provider_reference) || undefined,
      providerTransactionId: text(row.provider_transaction_id) || undefined,
      idempotencyKey: text(row.idempotency_key), createdAt: iso(row.created_at),
      confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : undefined,
    }
    paymentByOrder.set(payment.orderId, payment)
    return payment
  })
  const taxesByItem = new Map<string, TaxLine[]>()
  for (const tax of taxItemRows) {
    const id = text(tax.order_item_id)
    taxesByItem.set(id, [...(taxesByItem.get(id) ?? []), {
      code: text(tax.component_code), name: text(tax.component_name_snapshot), ratePercent: number(tax.rate_percent),
      baseMinor: number(tax.taxable_base_amount), taxMinor: number(tax.tax_amount),
    }])
  }
  const itemsByOrder = new Map<string, CalculatedLine[]>()
  const productById = new Map(products.map((product) => [product.id, product]))
  for (const row of itemRows) {
    const productId = text(row.product_id)
    const line: CalculatedLine = {
      productId, name: text(row.product_name_snapshot), sku: text(row.sku_snapshot),
      quantity: number(row.quantity), unitPriceMinor: number(row.unit_price),
      priceMode: text(row.price_mode, 'inclusive') as CalculatedLine['priceMode'],
      categoryId: productById.get(productId)?.categoryId ?? '', categoryName: productById.get(productId)?.categoryName ?? 'General',
      taxCategoryId: productById.get(productId)?.taxCategoryId ?? '', taxCategoryName: text(row.tax_category_name_snapshot),
      taxableBaseMinor: number(row.line_subtotal), taxRatePercent: number(row.tax_rate),
      taxMinor: number(row.tax_amount), grossMinor: number(row.line_total), taxBreakdown: taxesByItem.get(text(row.id)) ?? [],
    }
    const orderId = text(row.order_id)
    itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), line])
  }
  const orders: Order[] = orderRows.map((row) => {
    const payment = paymentByOrder.get(text(row.id))
    const status = text(row.status, 'pending_payment')
    return {
      id: text(row.id), clientOrderId: text(row.client_order_id), storeId: text(row.store_id),
      deviceId: text(row.device_id), employeeId: text(row.employee_id),
      employeeName: employeeNames.get(text(row.employee_id)) ?? 'Staff member', shiftId: text(row.shift_id) || undefined,
      orderNumber: text(row.order_number, text(row.id).slice(0, 8)),
      status: status === 'partially_refunded' || status === 'refunded' || status === 'voided' ? status : status === 'paid' ? 'paid' : 'pending_payment',
      currencyCode: text(row.currency_code, 'GHS'), subtotalMinor: number(row.subtotal_amount), taxMinor: number(row.tax_amount),
      totalMinor: number(row.total_amount), items: itemsByOrder.get(text(row.id)) ?? [],
      paymentMethod: payment?.method, paymentStatus: payment?.status, providerReference: payment?.providerReference,
      providerTransactionId: payment?.providerTransactionId, refundedMinor: 0,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), localCreatedAt: iso(row.local_created_at ?? row.created_at),
      syncStatus: 'synced', source: 'cloud',
    }
  })
  const orderItemById = new Map(itemRows.map((row) => [text(row.id), row]))
  const refundLinesByRefund = new Map<string, Refund['lines']>()
  for (const row of refundItemRows) {
    const item = orderItemById.get(text(row.order_item_id))
    if (!item) continue
    const refundId = text(row.refund_id)
    const line = {
      orderLineId: text(row.order_item_id), productId: text(item.product_id), productName: text(item.product_name_snapshot),
      quantity: number(row.quantity), restock: Boolean(row.restock), itemMinor: number(row.item_amount), taxMinor: number(row.tax_amount),
    }
    refundLinesByRefund.set(refundId, [...(refundLinesByRefund.get(refundId) ?? []), line])
  }
  const orderMap = new Map(orders.map((order) => [order.id, order]))
  const refunds: Refund[] = refundRows.map((row) => {
    const status = text(row.status, 'pending')
    const refundStatus: RefundStatus = status === 'processed' || status === 'failed' || status === 'processing' || status === 'needs_attention' ? status : 'pending'
    const refund: Refund = {
      id: text(row.id), storeId: text(row.store_id), orderId: text(row.order_id), paymentId: text(row.payment_id) || undefined,
      orderNumber: orderMap.get(text(row.order_id))?.orderNumber ?? '', amountMinor: number(row.amount), taxMinor: number(row.tax_amount),
      method: paymentByOrder.get(text(row.order_id))?.method ?? 'cash', status: refundStatus,
      reason: text(row.reason), lines: refundLinesByRefund.get(text(row.id)) ?? [],
      createdAt: iso(row.created_at), providerRefundId: text(row.provider_refund_id) || undefined, syncStatus: 'synced',
    }
    const order = orderMap.get(refund.orderId)
    if (order && refund.status === 'processed') order.refundedMinor += refund.amountMinor
    return refund
  })
  const shifts: Shift[] = shiftRows.map((row) => ({
    id: text(row.id), storeId: text(row.store_id), deviceId: text(row.device_id), employeeId: text(row.employee_id),
    employeeName: employeeNames.get(text(row.employee_id)) ?? 'Staff member',
    status: text(row.status) === 'open' ? 'open' : 'closed', openingFloatMinor: number(row.opening_float),
    expectedCashMinor: number(row.expected_cash), countedCashMinor: row.counted_cash == null ? undefined : number(row.counted_cash),
    varianceMinor: row.variance_amount == null ? undefined : number(row.variance_amount),
    varianceReason: text(row.variance_reason) || undefined, openedAt: iso(row.opened_at),
    closedAt: row.closed_at ? iso(row.closed_at) : undefined, syncStatus: 'synced',
  }))
  const movements: InventoryMovement[] = movementRows.map((row) => ({
    id: text(row.id), storeId: text(row.store_id), productId: text(row.product_id),
    deviceId: text(row.device_id), employeeId: text(row.employee_id),
    movementType: text(row.movement_type, 'sale') as InventoryMovement['movementType'],
    quantityDelta: number(row.quantity_delta), baseVersion: row.base_inventory_version == null ? undefined : number(row.base_inventory_version),
    orderId: text(row.order_id) || undefined, refundId: text(row.refund_id) || undefined,
    reason: text(row.reason) || undefined, createdAt: iso(row.created_at), syncStatus: 'synced',
  }))

  await db.transaction('rw', [db.products, db.taxCategories, db.inventory, db.employees, db.orders, db.payments, db.refunds, db.shifts, db.inventoryMovements, db.appMeta], async () => {
    if (taxCategories.length) await db.taxCategories.bulkPut(taxCategories)
    if (products.length) await db.products.bulkPut(products)
    if (inventory.length) await db.inventory.bulkPut(inventory)
    if (employees.length) await db.employees.bulkPut(employees)
    if (orders.length) await db.orders.bulkPut(orders)
    if (payments.length) await db.payments.bulkPut(payments)
    if (refunds.length) await db.refunds.bulkPut(refunds)
    if (shifts.length) await db.shifts.bulkPut(shifts)
    if (movements.length) await db.inventoryMovements.bulkPut(movements)
  })
  await setMeta('cloud-daily-reports', arr(payload.dailyReports))
  const storeProfile = payload.store && typeof payload.store === 'object' ? payload.store as Record<string, unknown> : null
  if (typeof storeProfile?.name === 'string' && storeProfile.name.trim()) await setMeta('shop-name', storeProfile.name.trim())
  await setMeta('cloud-pull-cursor', text(payload.serverTime, new Date().toISOString()))
  return { pulled: products.length + orders.length + shifts.length + inventory.length, configured: true }
}

export async function syncNow() {
  const pushed = await pushOutbox()
  const pulled = await pullCloud()
  return { pushed, pulled }
}
