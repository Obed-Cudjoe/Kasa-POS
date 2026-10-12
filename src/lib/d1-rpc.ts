import type {} from '@cloudflare/workers-types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Obj = Record<string, unknown>
type EventIdentity = { storeId: string; deviceId: string; employeeId: string; eventId: string }

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : value == null ? fallback : String(value)
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const bool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : value == null ? fallback : Boolean(value)
const isoNow = () => new Date().toISOString()
const serialize = (value: unknown) => JSON.stringify(value ?? null)
const safeJson = (value: unknown) => typeof value === 'string' ? (() => { try { return JSON.parse(value) as unknown } catch { return {} } })() : value ?? {}

function assertId(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`Sync event has an invalid ${label}.`)
}

function eventGuard(identity: EventIdentity) {
  return {
    sql: "EXISTS (SELECT 1 FROM sync_events WHERE store_id = ? AND device_id = ? AND client_event_id = ? AND result_status = 'processing')",
    values: [identity.storeId, identity.deviceId, identity.eventId],
  }
}

const JSON_FIELDS = new Set(['tax_snapshot', 'provider_metadata', 'response_summary'])
function dbValue(field: string, value: unknown) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (JSON_FIELDS.has(field) && value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

function guardedInsert(db: D1Database, table: string, record: Obj, identity: EventIdentity, conflict = '', extraGuard?: { sql: string; values: unknown[] }) {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined)
  const names = entries.map(([name]) => `"${name}"`).join(', ')
  const placeholders = entries.map(() => '?').join(', ')
  const guard = eventGuard(identity)
  let sql = `INSERT INTO "${table}" (${names}) SELECT ${placeholders} WHERE ${guard.sql}`
  if (extraGuard) sql += ` AND (${extraGuard.sql})`
  if (conflict) sql += ` ${conflict}`
  return db.prepare(sql).bind(...entries.map(([name, value]) => dbValue(name, value)), ...guard.values, ...(extraGuard?.values ?? []))
}

function guardedUpdate(db: D1Database, table: string, values: Obj, where: string, whereValues: unknown[], identity: EventIdentity) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined)
  const setSql = entries.map(([name]) => `"${name}" = ?`).join(', ')
  const guard = eventGuard(identity)
  return db.prepare(`UPDATE "${table}" SET ${setSql} WHERE (${where}) AND ${guard.sql}`)
    .bind(...entries.map(([name, value]) => dbValue(name, value)), ...whereValues, ...guard.values)
}

function upsertClause(columns: string[], updates: string[]) {
  return `ON CONFLICT (${columns.map((name) => `"${name}"`).join(', ')}) DO UPDATE SET ${updates.map((name) => `"${name}" = excluded."${name}"`).join(', ')}`
}

async function first<T extends Record<string, unknown>>(db: D1Database, sql: string, ...values: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...values).first<T>() ?? null
}

type MovementCheck = { id: string; productId: string; movementType: string }

async function applyMovement(
  db: D1Database,
  identity: EventIdentity,
  movementValue: unknown,
  summary: Obj,
  statements: D1PreparedStatement[],
  movementChecks: MovementCheck[],
) {
  const movement = object(movementValue)
  const movementId = text(movement.id)
  const productId = text(movement.productId)
  const type = text(movement.movementType)
  const delta = number(movement.quantityDelta, Number.NaN)
  if (!UUID_PATTERN.test(movementId) || !UUID_PATTERN.test(productId) || !Number.isFinite(delta) || delta === 0) {
    throw new Error('Inventory movement is missing a valid ID, product, or non-zero quantity.')
  }
  if (!['sale','return','receive','count_adjustment','damage','opening_balance'].includes(type)) throw new Error('Unsupported inventory movement type.')
  const product = await first<{ id: string }>(db, 'SELECT id FROM products WHERE store_id = ? AND id = ?', identity.storeId, productId)
  if (!product) throw new Error('Inventory movement references a product not found in this store.')
  const current = await first<{ row_version: number }>(db,
    'SELECT row_version FROM inventory WHERE store_id = ? AND product_id = ?', identity.storeId, productId)
  const baseVersion = movement.baseVersion == null ? null : number(movement.baseVersion, Number.NaN)
  if (type === 'count_adjustment' && number(current?.row_version, 0) !== baseVersion) {
    summary.inventoryReview = true
    summary.productId = productId
    summary.reason = 'Stock changed since the physical count was started. Review current stock and recount.'
    return false
  }
  const duplicateMovement = await first<{ id: string }>(db,
    'SELECT id FROM inventory_movements WHERE store_id = ? AND device_id = ? AND client_event_id = ?',
    identity.storeId, identity.deviceId, movementId)
  if (duplicateMovement) return true

  const now = isoNow()
  const movementRow = {
    id: movementId, store_id: identity.storeId, product_id: productId, device_id: identity.deviceId,
    employee_id: identity.employeeId, movement_type: type, quantity_delta: delta,
    base_inventory_version: baseVersion, client_event_id: movementId,
    order_id: text(movement.orderId) || null, refund_id: text(movement.refundId) || null,
    reason: text(movement.reason) || null, occurred_at_device: text(movement.createdAt) || now, created_at: now,
  }
  const extraGuard = type === 'count_adjustment'
    ? { sql: 'EXISTS (SELECT 1 FROM inventory WHERE store_id = ? AND product_id = ? AND row_version = ?)', values: [identity.storeId, productId, baseVersion] }
    : undefined
  statements.push(guardedInsert(db, 'inventory_movements', movementRow, identity,
    'ON CONFLICT (store_id, device_id, client_event_id) DO NOTHING', extraGuard))
  const guard = eventGuard(identity)
  statements.push(db.prepare(`UPDATE inventory SET quantity_on_hand = quantity_on_hand + ?, row_version = row_version + 1, updated_at = ?
    WHERE store_id = ? AND product_id = ? AND (? <> 'count_adjustment' OR row_version = ?)
    AND changes() = 1
    AND EXISTS (SELECT 1 FROM inventory_movements WHERE store_id = ? AND device_id = ? AND client_event_id = ?)
    AND ${guard.sql}`)
    .bind(delta, now, identity.storeId, productId, type, baseVersion, identity.storeId, identity.deviceId, movementId, ...guard.values))
  movementChecks.push({ id: movementId, productId, movementType: type })
  return true
}

async function ingestPosEvent(db: D1Database, value: unknown) {
  const event = object(value)
  const identity: EventIdentity = {
    storeId: text(event.storeId), deviceId: text(event.deviceId), employeeId: text(event.employeeId), eventId: text(event.eventId),
  }
  for (const [value, label] of [[identity.storeId, 'store ID'], [identity.deviceId, 'device ID'], [identity.employeeId, 'employee ID'], [identity.eventId, 'event ID']] as const) assertId(value, label)

  const existing = await first<{ result_status: string; response_summary: unknown }>(db,
    'SELECT result_status, response_summary FROM sync_events WHERE store_id = ? AND device_id = ? AND client_event_id = ?',
    identity.storeId, identity.deviceId, identity.eventId,
  )
  if (existing) return { eventId: identity.eventId, status: existing.result_status === 'processing' ? 'conflict' : existing.result_status,
    summary: safeJson(existing.response_summary), duplicate: true }

  const employee = await first<{ id: string; role: string; status: string; refund_limit_minor: number | null }>(db,
    'SELECT id, role, status, refund_limit_minor FROM employees WHERE store_id = ? AND id = ?', identity.storeId, identity.employeeId,
  )
  if (!employee || employee.status !== 'active') throw new Error('Sync employee is not active in this store.')
  const device = await first<{ status: string }>(db, 'SELECT status FROM devices WHERE store_id = ? AND id = ?', identity.storeId, identity.deviceId)
  if (device?.status === 'revoked') throw new Error('This POS device has been revoked.')

  const eventType = text(event.eventType)
  if (!['order','inventory_movement','refund','shift','product','tax'].includes(eventType)) throw new Error(`Unsupported sync event type: ${eventType || 'missing'}`)
  const payload = object(event.payload)
  const summary: Obj = {}
  const statements: D1PreparedStatement[] = []
  const movementChecks: MovementCheck[] = []
  const now = isoNow()

  // Keep the device heartbeat inside the same transaction as its first event.
  statements.push(db.prepare(`INSERT INTO devices (id, store_id, device_name, platform, status, enrolled_by, last_seen_at)
    VALUES (?, ?, 'POS tablet', 'web-pwa', 'active', ?, ?)
    ON CONFLICT (store_id, id) DO UPDATE SET last_seen_at = excluded.last_seen_at`)
    .bind(identity.deviceId, identity.storeId, identity.employeeId, now))
  const payloadHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialize(event)))
  const payloadHashHex = Array.from(new Uint8Array(payloadHash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  statements.push(db.prepare(`INSERT INTO sync_events (id, store_id, device_id, employee_id, client_event_id, event_type, payload_hash, result_status, response_summary, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', '{}', ?)
    ON CONFLICT (store_id, device_id, client_event_id) DO NOTHING`)
    .bind(identity.eventId, identity.storeId, identity.deviceId, identity.employeeId, identity.eventId, eventType, payloadHashHex, now))

  if (eventType === 'order') {
    const order = object(payload.order)
    const payment = object(payload.payment)
    const orderId = text(order.id)
    const paymentId = text(payment.id)
    assertId(orderId, 'order ID')
    assertId(paymentId, 'payment ID')
    if (!orderId || !paymentId) throw new Error('Order event must contain an order and payment.')
    const method = text(payment.method)
    const paymentStatus = text(payment.status)
    const orderStatus = text(order.status)
    if (!['cash','card','momo'].includes(method)) throw new Error('Unsupported tender method.')
    if (method === 'cash' && paymentStatus !== 'confirmed') throw new Error('Cash sales must be recorded as confirmed.')
    if (method !== 'cash' && (paymentStatus !== 'pending' || orderStatus !== 'pending_payment')) {
      throw new Error('An unverified digital payment must remain pending.')
    }
    if (method === 'cash' && orderStatus !== 'paid') throw new Error('A cash sale must be marked paid.')
    const orderRow = {
      id: orderId, store_id: identity.storeId, device_id: identity.deviceId, employee_id: identity.employeeId,
      shift_id: text(order.shiftId) || null, client_order_id: text(order.clientOrderId), order_number: text(order.orderNumber),
      status: orderStatus, currency_code: text(order.currencyCode, 'GHS'), subtotal_amount: number(order.subtotalMinor),
      tax_amount: number(order.taxMinor), total_amount: number(order.totalMinor), tax_snapshot: array(order.items),
      local_created_at: text(order.localCreatedAt) || null, created_at: text(order.createdAt) || now,
      updated_at: now, paid_at: method === 'cash' ? now : null,
    }
    if (!orderRow.client_order_id) throw new Error('Order is missing its idempotency key.')
    statements.push(guardedInsert(db, 'orders', orderRow, identity,
      'ON CONFLICT (store_id, device_id, client_order_id) DO NOTHING'))

    const lines = array(order.items)
    for (const lineValue of lines) {
      const line = object(lineValue)
      const orderItemId = crypto.randomUUID()
      const productId = text(line.productId)
      const itemRow = {
        id: orderItemId, store_id: identity.storeId, order_id: orderId, product_id: productId || null,
        product_name_snapshot: text(line.name, 'Item'), sku_snapshot: text(line.sku) || null,
        tax_category_name_snapshot: text(line.taxCategoryName, 'Unconfigured'), quantity: number(line.quantity),
        currency_code: text(order.currencyCode, 'GHS'), price_mode: text(line.priceMode, 'inclusive'),
        unit_price: number(line.unitPriceMinor), line_subtotal: number(line.taxableBaseMinor),
        tax_rate: number(line.taxRatePercent), tax_amount: number(line.taxMinor), line_total: number(line.grossMinor),
        tax_snapshot: array(line.taxBreakdown), created_at: text(order.createdAt) || now,
      }
      statements.push(guardedInsert(db, 'order_items', itemRow, identity))
      for (const taxValue of array(line.taxBreakdown)) {
        const tax = object(taxValue)
        statements.push(guardedInsert(db, 'order_item_taxes', {
          id: crypto.randomUUID(), store_id: identity.storeId, order_item_id: orderItemId,
          component_code: text(tax.code), component_name_snapshot: text(tax.name), rate_percent: number(tax.ratePercent),
          taxable_base_amount: number(tax.baseMinor), tax_amount: number(tax.taxMinor), calculation_method: 'same_base',
          calculation_order: 1, created_at: text(order.createdAt) || now,
        }, identity, 'ON CONFLICT (store_id, order_item_id, component_code) DO NOTHING'))
      }
    }

    const provider = method === 'cash' ? null : text(payment.provider, 'paystack')
    statements.push(guardedInsert(db, 'payments', {
      id: paymentId, store_id: identity.storeId, order_id: orderId, device_id: identity.deviceId,
      method, provider, provider_network: text(payment.providerNetwork) || null,
      provider_reference: text(payment.providerReference) || null,
      provider_transaction_id: text(payment.providerTransactionId) || null,
      idempotency_key: text(payment.idempotencyKey, paymentId), status: paymentStatus,
      amount: number(payment.amountMinor), currency_code: text(payment.currencyCode, 'GHS'),
      created_at: text(payment.createdAt) || now, confirmed_at: method === 'cash' ? now : null, updated_at: now,
    }, identity, 'ON CONFLICT (store_id, idempotency_key) DO NOTHING'))

    summary.orderId = orderId
    summary.orderNumber = text(order.orderNumber)
    for (const movement of array(payload.inventoryMovements)) {
      const movementResult = await applyMovement(db, identity, movement, summary, statements, movementChecks)
      if (!movementResult) summary.inventoryReview = true
    }
  } else if (eventType === 'inventory_movement') {
    const movement = payload.movement ?? payload
    const accepted = await applyMovement(db, identity, movement, summary, statements, movementChecks)
    if (!accepted) summary.inventoryReview = true
    else summary.movementId = text(object(movement).id)
  } else if (eventType === 'refund') {
    const refund = object(payload.refund)
    const orderId = text(refund.orderId)
    const refundId = text(refund.id)
    const paymentId = text(refund.paymentId) || text(object(payload.payment).id)
    assertId(orderId, 'refund order ID')
    assertId(refundId, 'refund ID')
    assertId(paymentId, 'refund payment ID')
    const order = await first<{ total_amount: number; currency_code: string }>(db,
      'SELECT total_amount, currency_code FROM orders WHERE store_id = ? AND id = ?', identity.storeId, orderId)
    if (!order) throw new Error('Original order is not present in cloud.')
    const existingRefunds = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds WHERE store_id = ? AND order_id = ? AND status <> ?')
      .bind(identity.storeId, orderId, 'failed').first<{ amount: number }>()
    const refundAmount = number(refund.amountMinor)
    if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || number(existingRefunds?.amount) + refundAmount > number(order.total_amount)) {
      throw new Error('Refund would exceed the remaining captured sale amount.')
    }
    const createdAt = text(refund.createdAt) || now
    const status = text(refund.method) === 'cash' ? 'processed' : 'pending'
    statements.push(guardedInsert(db, 'refunds', {
      id: refundId, store_id: identity.storeId, order_id: orderId, payment_id: paymentId,
      requested_by: identity.employeeId, approved_by: status === 'processed' ? identity.employeeId : null,
      device_id: identity.deviceId, idempotency_key: identity.eventId, status,
      reason: text(refund.reason, 'Customer return'), amount: refundAmount, tax_amount: number(refund.taxMinor),
      currency_code: text(order.currency_code, 'GHS'), provider_refund_id: text(refund.providerRefundId) || null,
      offline_created_at: createdAt, created_at: createdAt, processed_at: status === 'processed' ? createdAt : null,
      updated_at: now,
    }, identity, 'ON CONFLICT (store_id, idempotency_key) DO NOTHING'))

    const orderItems = await db.prepare('SELECT id, product_id FROM order_items WHERE store_id = ? AND order_id = ?')
      .bind(identity.storeId, orderId).all<{ id: string; product_id: string | null }>()
    const itemIdByProduct = new Map((orderItems.results ?? []).map((row) => [String(row.product_id), String(row.id)]))
    for (const lineValue of array(refund.lines)) {
      const line = object(lineValue)
      const productId = text(line.productId)
      const orderItemId = itemIdByProduct.get(productId)
      if (!orderItemId) throw new Error('Returned product is not on the original order.')
      statements.push(guardedInsert(db, 'refund_items', {
        id: crypto.randomUUID(), store_id: identity.storeId, refund_id: refundId, order_item_id: orderItemId,
        quantity: number(line.quantity), restock: bool(line.restock, true), item_amount: number(line.itemMinor),
        tax_amount: number(line.taxMinor), created_at: createdAt,
      }, identity, 'ON CONFLICT (store_id, refund_id, order_item_id) DO NOTHING'))
    }
    for (const movement of array(payload.inventoryMovements)) {
      const accepted = await applyMovement(db, identity, movement, summary, statements, movementChecks)
      if (!accepted) summary.inventoryReview = true
    }
    const guard = eventGuard(identity)
    statements.push(db.prepare(`UPDATE orders SET status = CASE
      WHEN (SELECT COALESCE(SUM(amount),0) FROM refunds WHERE store_id = ? AND order_id = ? AND status = 'processed') >= total_amount THEN 'refunded'
      WHEN (SELECT COALESCE(SUM(amount),0) FROM refunds WHERE store_id = ? AND order_id = ? AND status = 'processed') > 0
        OR EXISTS (SELECT 1 FROM refunds WHERE store_id = ? AND order_id = ? AND status IN ('requested','pending','processing','needs_attention')) THEN 'partially_refunded'
      ELSE 'paid' END, updated_at = ?
      WHERE store_id = ? AND id = ? AND ${guard.sql}`)
      .bind(identity.storeId, orderId, identity.storeId, orderId, identity.storeId, orderId, now, identity.storeId, orderId, ...guard.values))
    statements.push(db.prepare(`UPDATE payments SET status = CASE
      WHEN (SELECT status FROM orders WHERE store_id = ? AND id = ?) = 'refunded' THEN 'refunded'
      WHEN (SELECT status FROM orders WHERE store_id = ? AND id = ?) = 'partially_refunded' AND EXISTS (
        SELECT 1 FROM refunds WHERE store_id = ? AND order_id = ? AND status = 'processed') THEN 'partially_refunded'
      ELSE 'confirmed' END, updated_at = ?
      WHERE store_id = ? AND id = ? AND ${guard.sql}`)
      .bind(identity.storeId, orderId, identity.storeId, orderId, identity.storeId, orderId, now, identity.storeId, paymentId, ...guard.values))
    summary.refundId = refundId
    summary.orderId = orderId
  } else if (eventType === 'shift') {
    const shift = object(payload.shift ?? payload)
    const shiftId = text(shift.id)
    assertId(shiftId, 'shift ID')
    const status = text(shift.status) === 'closed' ? 'closed' : 'open'
    statements.push(guardedInsert(db, 'shifts', {
      id: shiftId, store_id: identity.storeId, device_id: identity.deviceId, employee_id: identity.employeeId,
      status, currency_code: 'GHS', opening_float: number(shift.openingFloatMinor),
      expected_cash: shift.expectedCashMinor == null ? null : number(shift.expectedCashMinor),
      counted_cash: shift.countedCashMinor == null ? null : number(shift.countedCashMinor),
      variance_amount: shift.varianceMinor == null ? null : number(shift.varianceMinor),
      variance_reason: text(shift.varianceReason) || null, opened_at_device: text(shift.openedAt) || null,
      opened_at: text(shift.openedAt) || now, closed_at_device: text(shift.closedAt) || null,
      closed_at: text(shift.closedAt) || null, closed_by: status === 'closed' ? identity.employeeId : null,
    }, identity, upsertClause(['store_id','id'], ['status','expected_cash','counted_cash','variance_amount','variance_reason','closed_at_device','closed_at','closed_by'])))
    summary.shiftId = shiftId
  } else if (eventType === 'product') {
    const product = object(payload.product ?? payload)
    const productId = text(product.id)
    const categoryId = text(product.categoryId)
    const taxCategoryId = text(product.taxCategoryId)
    assertId(productId, 'product ID')
    assertId(categoryId, 'category ID')
    assertId(taxCategoryId, 'tax category ID')
    const categoryName = text(product.categoryName, 'General')
    const barcode = text(product.barcode).trim()
    if (barcode && !/^[A-Za-z0-9._/-]{1,64}$/.test(barcode)) throw new Error('Product barcode may contain only letters, numbers, dots, underscores, slashes, or hyphens (max 64 characters).')
    const tax = await first<{ id: string }>(db, 'SELECT id FROM tax_categories WHERE store_id = ? AND id = ?', identity.storeId, taxCategoryId)
    if (!tax) throw new Error('Configure a store tax category before syncing products.')
    statements.push(guardedInsert(db, 'categories', {
      id: categoryId, store_id: identity.storeId, name: categoryName, active: true, updated_at: now,
    }, identity, upsertClause(['store_id','id'], ['name','active','updated_at'])))
    statements.push(guardedInsert(db, 'products', {
      id: productId, store_id: identity.storeId, category_id: categoryId, tax_category_id: taxCategoryId,
      name: text(product.name), sku: text(product.sku) || null, barcode: barcode || null, unit_name: text(product.unitName, 'each'),
      price_minor: number(product.priceMinor), currency_code: text(product.currencyCode, 'GHS'),
      price_mode: text(product.priceMode, 'inclusive'), tax_rate: product.taxRateOverride == null ? null : number(product.taxRateOverride),
      active: bool(product.active, true), row_version: Math.max(1, number(product.rowVersion, 1)),
      created_at: text(product.createdAt) || now, updated_at: now,
    }, identity, upsertClause(['store_id','id'], ['category_id','tax_category_id','name','sku','barcode','unit_name','price_minor','currency_code','price_mode','tax_rate','active','row_version','updated_at'])))
    statements.push(guardedInsert(db, 'inventory', {
      store_id: identity.storeId, product_id: productId, quantity_on_hand: 0, row_version: 1, updated_at: now,
    }, identity, 'ON CONFLICT (store_id, product_id) DO NOTHING'))
    summary.productId = productId
  } else if (eventType === 'tax') {
    const tax = object(payload.taxCategory ?? payload)
    const taxId = text(tax.id)
    assertId(taxId, 'tax category ID')
    const effectiveFrom = text(tax.effectiveFrom, new Date().toISOString().slice(0, 10))
    statements.push(guardedInsert(db, 'tax_categories', {
      id: taxId, store_id: identity.storeId, code: text(tax.code), name: text(tax.name),
      treatment: text(tax.treatment), jurisdiction_code: 'GH',
      default_price_mode: text(tax.defaultPriceMode, 'inclusive'), active: bool(tax.active, true),
      effective_from: effectiveFrom, effective_to: null, updated_at: now,
    }, identity, upsertClause(['store_id','id'], ['code','name','treatment','default_price_mode','active','effective_from','updated_at'])))
    statements.push(guardedUpdate(db, 'tax_rates', { active: false }, 'store_id = ? AND tax_category_id = ? AND active = 1', [identity.storeId, taxId], identity))
    for (const componentValue of array(tax.components)) {
      const component = object(componentValue)
      const componentId = UUID_PATTERN.test(text(component.id)) ? text(component.id) : crypto.randomUUID()
      const rateValues = {
        id: componentId, store_id: identity.storeId, tax_category_id: taxId,
        component_code: text(component.code), component_name: text(component.name),
        rate_percent: number(component.ratePercent), calculation_method: text(component.method, 'same_base'),
        calculation_order: Math.max(1, number(component.order, 1)), effective_from: effectiveFrom,
        effective_to: null, active: true, created_at: now,
      }
      statements.push(guardedInsert(db, 'tax_rates', rateValues, identity,
        upsertClause(['store_id','tax_category_id','component_code','effective_from'], ['component_name','rate_percent','calculation_method','calculation_order','active'])))
    }
    summary.taxCategoryId = taxId
  }

  // Finalize the event marker in the same D1 batch as its domain writes. Duplicate retries
  // cannot replay a completed order/refund or apply inventory twice.
  const finalSummary = { ...summary }
  const conflictPredicates: string[] = []
  const conflictValues: unknown[] = []
  if (summary.inventoryReview) conflictPredicates.push('1 = 1')
  const affectedProducts = [...new Set(movementChecks.map((check) => check.productId))]
  if (affectedProducts.length) {
    conflictPredicates.push(`EXISTS (SELECT 1 FROM inventory WHERE store_id = ? AND product_id IN (${affectedProducts.map(() => '?').join(', ')}) AND quantity_on_hand < 0)`)
    conflictValues.push(identity.storeId, ...affectedProducts)
  }
  for (const check of movementChecks.filter((movement) => movement.movementType === 'count_adjustment')) {
    conflictPredicates.push('NOT EXISTS (SELECT 1 FROM inventory_movements WHERE store_id = ? AND device_id = ? AND client_event_id = ?)')
    conflictValues.push(identity.storeId, identity.deviceId, check.id)
  }
  const conflictCondition = conflictPredicates.length ? conflictPredicates.map((predicate) => `(${predicate})`).join(' OR ') : '0 = 1'
  const resultReference = text(summary.orderId || summary.productId || summary.refundId || summary.movementId || summary.shiftId) || null
  const summaryJson = serialize(finalSummary)
  statements.push(db.prepare(`UPDATE sync_events SET
      result_status = CASE WHEN (${conflictCondition}) THEN 'conflict' ELSE 'accepted' END,
      response_summary = CASE WHEN (${conflictCondition}) THEN json_set(?, '$.inventoryReview', 1) ELSE ? END,
      result_reference = ?
    WHERE store_id = ? AND device_id = ? AND client_event_id = ? AND result_status = 'processing'`)
    .bind(...conflictValues, ...conflictValues, summaryJson, summaryJson, resultReference,
      identity.storeId, identity.deviceId, identity.eventId))

  await db.batch(statements)
  const saved = await first<{ result_status: string; response_summary: unknown }>(db,
    'SELECT result_status, response_summary FROM sync_events WHERE store_id = ? AND device_id = ? AND client_event_id = ?',
    identity.storeId, identity.deviceId, identity.eventId,
  )
  if (!saved) throw new Error('Sync event did not complete.')
  return { eventId: identity.eventId, status: saved.result_status, summary: safeJson(saved.response_summary), duplicate: false }
}

async function stableUuid(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

async function confirmPaystackPayment(db: D1Database, args: Obj) {
  const reference = text(args.p_reference)
  const amount = number(args.p_amount, Number.NaN)
  const currency = text(args.p_currency)
  const transactionId = text(args.p_transaction_id)
  if (!reference || !Number.isSafeInteger(amount) || !currency) throw new Error('Paystack confirmation data is incomplete.')
  const payment = await first<{ id: string; store_id: string; order_id: string; device_id: string; amount: number; currency_code: string; status: string }>(db,
    'SELECT id, store_id, order_id, device_id, amount, currency_code, status FROM payments WHERE provider = ? AND provider_reference = ?', 'paystack', reference)
  if (!payment) throw new Error('Payment reference is not linked to a POS order.')
  if (Number(payment.amount) !== amount || payment.currency_code !== currency) throw new Error('Verified provider amount or currency does not match the POS order.')
  if (['confirmed','partially_refunded','refunded'].includes(payment.status)) return { status: 'already_confirmed', orderId: payment.order_id }
  const order = await first<{ id: string; employee_id: string; status: string }>(db,
    'SELECT id, employee_id, status FROM orders WHERE store_id = ? AND id = ?', payment.store_id, payment.order_id)
  if (!order) throw new Error('Linked POS order is missing.')
  const items = await db.prepare('SELECT id, product_id, quantity FROM order_items WHERE store_id = ? AND order_id = ?')
    .bind(payment.store_id, payment.order_id).all<{ id: string; product_id: string | null; quantity: number }>()
  const now = isoNow()
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE payments SET status = 'confirmed', provider_transaction_id = ?, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
      WHERE store_id = ? AND id = ? AND status IN ('pending','initiated')`)
      .bind(transactionId || null, now, now, payment.store_id, payment.id),
    db.prepare(`UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ?
      WHERE store_id = ? AND id = ? AND status = 'pending_payment'`)
      .bind(now, now, payment.store_id, payment.order_id),
  ]
  for (const item of items.results ?? []) {
    if (!item.product_id) continue
    const movementId = await stableUuid(`${payment.id}:${item.id}:paystack-confirmed`)
    const delta = -number(item.quantity)
    statements.push(db.prepare(`UPDATE inventory SET quantity_on_hand = quantity_on_hand + ?, row_version = row_version + 1, updated_at = ?
      WHERE store_id = ? AND product_id = ?
      AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE store_id = ? AND device_id = ? AND client_event_id = ?)`)
      .bind(delta, now, payment.store_id, item.product_id, payment.store_id, payment.device_id, movementId))
    statements.push(db.prepare(`INSERT INTO inventory_movements
      (id, store_id, product_id, device_id, employee_id, movement_type, quantity_delta, client_event_id, order_id, occurred_at_device, created_at)
      SELECT ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM inventory WHERE store_id = ? AND product_id = ?)
      ON CONFLICT (store_id, device_id, client_event_id) DO NOTHING`)
      .bind(movementId, payment.store_id, item.product_id, payment.device_id, order.employee_id, delta, movementId,
        payment.order_id, now, now, payment.store_id, item.product_id))
  }
  await db.batch(statements)
  return { status: 'confirmed', orderId: payment.order_id, paymentId: payment.id }
}

export async function executeD1Rpc(db: D1Database, name: string, args: Record<string, unknown>) {
  if (name === 'ingest_pos_event') return ingestPosEvent(db, args.p_event)
  if (name === 'confirm_paystack_payment') return confirmPaystackPayment(db, args)
  throw new Error(`Unsupported database operation: ${name}`)
}
