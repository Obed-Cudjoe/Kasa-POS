import { db } from './local-db'
import { DEMO_DEVICE_ID, DEMO_STORE_ID } from './demo-seed'
import { summarizeLines } from './tax'
import { isWithinRefundLimit } from './permissions'
import { isValidBarcode, normalizeBarcode } from './barcode'
import type { CalculatedLine, Employee, InventoryItem, InventoryMovement, Order, Payment, PaymentMethod, PaymentStatus, Product, Refund, RefundLine, Shift, SyncEvent, TaxCategory } from './types'

export function newId() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random source is required to create transaction IDs.')
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function localDeviceId() {
  return typeof window !== 'undefined' ? localStorage.getItem('pos-device-id') ?? DEMO_DEVICE_ID : DEMO_DEVICE_ID
}

function makeSyncEvent(employee: Employee, eventType: SyncEvent['eventType'], entityId: string, payload: unknown): SyncEvent {
  return {
    eventId: newId(), storeId: employee.storeId, deviceId: localDeviceId(), employeeId: employee.id,
    eventType, entityId, payload, createdAt: new Date().toISOString(), status: 'pending',
  }
}

async function allocateOrderNumber(now = new Date(), deviceId = localDeviceId()) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '').slice(2)
  const deviceSuffix = deviceId.replaceAll('-', '').slice(-4).toUpperCase().padStart(4, '0')
  const key = `pos-order-sequence-${deviceSuffix}-${day}`
  return db.transaction('rw', db.appMeta, async () => {
    const current = await db.appMeta.get(key)
    const stored = Number(current?.value ?? 1049)
    const next = Number.isSafeInteger(stored) && stored >= 1 ? stored : 1049
    await db.appMeta.put({ key, value: next + 1, updatedAt: now.toISOString() })
    return `S-${day}-${deviceSuffix}-${String(next).padStart(4, '0')}`
  })
}

async function makeOrder(args: {
  employee: Employee
  shift?: Shift
  lines: CalculatedLine[]
  paymentMethod?: PaymentMethod
  paymentStatus?: PaymentStatus
  source: Order['source']
  status: Order['status']
  providerReference?: string
  providerTransactionId?: string
  cashTenderedMinor?: number
  changeMinor?: number
}) {
  const now = new Date().toISOString()
  const totals = summarizeLines(args.lines)
  const id = newId()
  const deviceId = localDeviceId()
  const orderNumber = await allocateOrderNumber(new Date(now), deviceId)
  const order: Order = {
    id, clientOrderId: newId(), storeId: args.employee.storeId || DEMO_STORE_ID,
    deviceId, employeeId: args.employee.id, employeeName: args.employee.displayName,
    shiftId: args.shift?.id, orderNumber, status: args.status,
    currencyCode: 'GHS', subtotalMinor: totals.subtotalMinor, taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor, items: args.lines, paymentMethod: args.paymentMethod,
    paymentStatus: args.paymentStatus, providerReference: args.providerReference,
    providerTransactionId: args.providerTransactionId, cashTenderedMinor: args.cashTenderedMinor,
    changeMinor: args.changeMinor, refundedMinor: 0, createdAt: now, updatedAt: now,
    localCreatedAt: now, syncStatus: args.source === 'demo' ? 'local' : 'pending', source: args.source,
  }
  return order
}

function makePayment(order: Order, method: PaymentMethod, status: PaymentStatus, provider?: Payment['provider'], network?: string): Payment {
  return {
    id: newId(), orderId: order.id, storeId: order.storeId, deviceId: order.deviceId,
    method, status, amountMinor: order.totalMinor, currencyCode: order.currencyCode,
    provider: provider ?? (method === 'cash' ? 'cash' : 'paystack'), providerNetwork: network,
    providerReference: order.providerReference, providerTransactionId: order.providerTransactionId,
    idempotencyKey: newId(), createdAt: order.createdAt,
    confirmedAt: status === 'confirmed' || status === 'demo_simulated' ? order.createdAt : undefined,
  }
}

async function moveInventoryForSale(order: Order, employee: Employee, isDemo: boolean) {
  const createdAt = new Date().toISOString()
  const movements: InventoryMovement[] = []
  const changedItems = new Map<string, InventoryItem>()
  for (const line of order.items) {
    const key: [string, string] = [order.storeId, line.productId]
    const current = changedItems.get(line.productId) ?? await db.inventory.get(key)
      ?? { storeId: order.storeId, productId: line.productId, quantityOnHand: 0, rowVersion: 0, updatedAt: createdAt }
    const movement: InventoryMovement = {
      id: newId(), storeId: order.storeId, productId: line.productId, deviceId: order.deviceId,
      employeeId: employee.id, movementType: 'sale', quantityDelta: -line.quantity,
      baseVersion: current.rowVersion, orderId: order.id, createdAt,
      syncStatus: isDemo ? 'local' : 'pending',
    }
    current.quantityOnHand -= line.quantity
    current.rowVersion += 1
    current.updatedAt = createdAt
    changedItems.set(line.productId, current)
    movements.push(movement)
  }
  await db.inventory.bulkPut([...changedItems.values()])
  await db.inventoryMovements.bulkPut(movements)
  return movements
}

export async function completePaidSale(args: {
  employee: Employee
  shift?: Shift
  lines: CalculatedLine[]
  paymentMethod: PaymentMethod
  paymentStatus: 'confirmed' | 'demo_simulated'
  source: 'local' | 'demo'
  cashTenderedMinor?: number
  providerReference?: string
  providerTransactionId?: string
  providerNetwork?: string
}) {
  if (!args.lines.length) throw new Error('Add at least one item before checkout.')
  const totals = summarizeLines(args.lines)
  if (args.paymentMethod === 'cash' && (args.cashTenderedMinor ?? 0) < totals.totalMinor) throw new Error('Cash received must cover the sale total.')
  const order = await makeOrder({
    employee: args.employee, shift: args.shift, lines: args.lines, paymentMethod: args.paymentMethod,
    paymentStatus: args.paymentStatus, source: args.source, status: 'paid',
    providerReference: args.providerReference, providerTransactionId: args.providerTransactionId,
    cashTenderedMinor: args.cashTenderedMinor,
    changeMinor: args.paymentMethod === 'cash' ? (args.cashTenderedMinor ?? 0) - totals.totalMinor : 0,
  })
  const payment = makePayment(order, args.paymentMethod, args.paymentStatus, args.source === 'demo' ? 'demo' : undefined, args.providerNetwork)
  const isDemo = args.source === 'demo'
  const event = isDemo ? undefined : makeSyncEvent(args.employee, 'order', order.id, { order, payment, inventoryMovements: [] })

  await db.transaction('rw', [db.orders, db.payments, db.inventory, db.inventoryMovements, db.syncOutbox, db.shifts], async () => {
    const movements = await moveInventoryForSale(order, args.employee, isDemo)
    await db.orders.add(order)
    await db.payments.add(payment)
    if (event) {
      event.payload = { order, payment, inventoryMovements: movements }
      await db.syncOutbox.add(event)
    }
    if (args.paymentMethod === 'cash' && args.shift) {
      await db.shifts.update(args.shift.id, { expectedCashMinor: args.shift.expectedCashMinor + order.totalMinor, syncStatus: isDemo ? 'local' : 'pending' })
    }
  })
  return { order, payment }
}

export async function createPendingDigitalOrder(args: {
  employee: Employee
  shift?: Shift
  lines: CalculatedLine[]
  method: Exclude<PaymentMethod, 'cash'>
  network?: string
}) {
  if (!args.lines.length) throw new Error('Add at least one item before checkout.')
  const order = await makeOrder({ employee: args.employee, shift: args.shift, lines: args.lines, paymentMethod: args.method, paymentStatus: 'pending', source: 'local', status: 'pending_payment' })
  const payment = makePayment(order, args.method, 'pending', 'paystack', args.network)
  const event = makeSyncEvent(args.employee, 'order', order.id, { order, payment, inventoryMovements: [] })
  await db.transaction('rw', [db.orders, db.payments, db.syncOutbox], async () => {
    await db.orders.add(order)
    await db.payments.add(payment)
    await db.syncOutbox.add(event)
  })
  return { order, payment }
}

export async function markDigitalPaymentConfirmed(orderId: string, details: { providerReference: string; providerTransactionId?: string; provider?: 'paystack' | 'flutterwave' }) {
  return db.transaction('rw', [db.orders, db.payments, db.employees, db.inventory, db.inventoryMovements], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('The sale could not be found on this device.')
    if (order.status === 'paid') return order
    if (order.status !== 'pending_payment' || !order.paymentMethod || order.paymentMethod === 'cash') {
      throw new Error('This is not a pending digital payment.')
    }
    const payment = await db.payments.where('orderId').equals(orderId).first()
    if (!payment) throw new Error('The pending payment record is missing.')
    const employee = await db.employees.get(order.employeeId)
    if (!employee) throw new Error('The cashier record is missing.')
    const confirmedAt = new Date().toISOString()
    const updatedOrder: Order = {
      ...order, status: 'paid', paymentStatus: 'confirmed', providerReference: details.providerReference,
      providerTransactionId: details.providerTransactionId, syncStatus: 'synced', updatedAt: confirmedAt,
    }
    const updatedPayment: Payment = {
      ...payment, status: 'confirmed', provider: details.provider ?? payment.provider,
      providerReference: details.providerReference, providerTransactionId: details.providerTransactionId,
      confirmedAt,
    }
    await moveInventoryForSale(updatedOrder, employee, false)
    await db.orders.put(updatedOrder)
    await db.payments.put(updatedPayment)
    return updatedOrder
  })
}

export async function createRefund(args: {
  order: Order
  employee: Employee
  lines: Array<{ productId: string; quantity: number; restock: boolean }>
  reason: string
  demoMode: boolean
}) {
  const employeeRefundLimit = args.employee.refundLimitMinor === undefined ? 0 : args.employee.refundLimitMinor
  if (employeeRefundLimit !== null && (!Number.isSafeInteger(employeeRefundLimit) || employeeRefundLimit < 0)) {
    throw new Error('Refund permission denied: the employee refund limit is not configured safely.')
  }

  return db.transaction('rw', [db.orders, db.payments, db.refunds, db.inventory, db.inventoryMovements, db.syncOutbox, db.shifts], async () => {
    const original = await db.orders.get(args.order.id)
    if (!original || original.storeId !== args.employee.storeId) throw new Error('The original sale is not available in this store.')
    if (!original.paymentMethod || !['paid', 'partially_refunded'].includes(original.status)) {
      throw new Error('Only a provider-confirmed sale can be refunded.')
    }
    const payment = await db.payments.where('orderId').equals(original.id).first()
    if (!payment) throw new Error('Original payment details are missing; refund cannot be started.')
    if (!['confirmed', 'demo_simulated', 'partially_refunded'].includes(payment.status)) {
      throw new Error('The original payment is not confirmed or is not eligible for another refund.')
    }

    const priorRefunds = await db.refunds.where('orderId').equals(original.id).toArray()
    if (priorRefunds.some((refund) => ['pending', 'processing', 'needs_attention'].includes(refund.status))) {
      throw new Error('A prior refund is still unresolved. Reconcile it before creating another refund.')
    }
    const refundedQuantity = new Map<string, number>()
    const refundedAmount = new Map<string, number>()
    const refundedTax = new Map<string, number>()
    for (const refund of priorRefunds) {
      for (const line of refund.lines) {
        // A failed provider reversal still represents a physical return. Never let a second
        // request refund/restock the same returned quantity without manager reconciliation.
        refundedQuantity.set(line.productId, (refundedQuantity.get(line.productId) ?? 0) + line.quantity)
        if (refund.status === 'failed') continue
        refundedAmount.set(line.productId, (refundedAmount.get(line.productId) ?? 0) + line.itemMinor + line.taxMinor)
        refundedTax.set(line.productId, (refundedTax.get(line.productId) ?? 0) + line.taxMinor)
      }
    }

    const requestedByProduct = new Map<string, { quantity: number; restock: boolean }>()
    for (const requested of args.lines) {
      if (!Number.isFinite(requested.quantity) || requested.quantity <= 0) throw new Error('Return quantities must be positive finite numbers.')
      const current = requestedByProduct.get(requested.productId)
      requestedByProduct.set(requested.productId, {
        quantity: (current?.quantity ?? 0) + requested.quantity,
        restock: Boolean(requested.restock) || Boolean(current?.restock),
      })
    }
    if (!requestedByProduct.size) throw new Error('Select at least one item to return.')

    const refundLines: RefundLine[] = []
    for (const [productId, requested] of requestedByProduct) {
      const sold = original.items.find((line) => line.productId === productId)
      if (!sold) throw new Error('A selected product is not part of this transaction.')
      const alreadyReturnedQuantity = refundedQuantity.get(productId) ?? 0
      const available = sold.quantity - alreadyReturnedQuantity
      if (requested.quantity > available + 0.0001) throw new Error(`Return quantity exceeds the remaining sold quantity for ${sold.name}.`)
      const remainingAmount = Math.max(0, sold.grossMinor - (refundedAmount.get(productId) ?? 0))
      const remainingTax = Math.max(0, sold.taxMinor - (refundedTax.get(productId) ?? 0))
      const isFinalQuantity = requested.quantity >= available - 0.0001
      const grossMinor = isFinalQuantity ? remainingAmount : Math.min(remainingAmount, Math.round(sold.grossMinor * requested.quantity / sold.quantity))
      const taxMinor = isFinalQuantity ? remainingTax : Math.min(grossMinor, remainingTax, Math.round(sold.taxMinor * requested.quantity / sold.quantity))
      refundLines.push({
        orderLineId: sold.productId, productId: sold.productId, productName: sold.name,
        quantity: requested.quantity, restock: requested.restock,
        itemMinor: grossMinor - taxMinor, taxMinor,
      })
    }

    const amountMinor = refundLines.reduce((sum, line) => sum + line.itemMinor + line.taxMinor, 0)
    const taxMinor = refundLines.reduce((sum, line) => sum + line.taxMinor, 0)
    if (amountMinor <= 0 || amountMinor > original.totalMinor - original.refundedMinor) {
      throw new Error('Refund total is invalid or exceeds the amount remaining on the original sale.')
    }
    if (!isWithinRefundLimit(amountMinor, employeeRefundLimit)) {
      throw new Error('Refund total exceeds this employee’s configured authorization limit.')
    }
    const status = original.paymentMethod === 'cash' ? 'processed' : 'pending'
    const now = new Date().toISOString()
    const refund: Refund = {
      id: newId(), storeId: original.storeId, orderId: original.id, paymentId: payment.id,
      orderNumber: original.orderNumber, amountMinor, taxMinor, method: original.paymentMethod,
      status, reason: args.reason.trim().slice(0, 200) || 'Customer return', lines: refundLines, createdAt: now,
      syncStatus: args.demoMode ? 'local' : 'pending',
    }
    const newlyConfirmed = status === 'processed' ? amountMinor : 0
    const confirmedRefundTotal = original.refundedMinor + newlyConfirmed
    const fullyRefunded = confirmedRefundTotal >= original.totalMinor
    const updatedOrder: Order = {
      ...original, refundedMinor: confirmedRefundTotal,
      status: fullyRefunded ? 'refunded' : confirmedRefundTotal > 0 || status !== 'processed' ? 'partially_refunded' : 'paid',
      paymentStatus: original.paymentMethod === 'cash'
        ? (fullyRefunded ? 'refunded' : 'partially_refunded')
        : 'refund_pending',
      syncStatus: args.demoMode ? original.syncStatus : 'pending', updatedAt: now,
    }
    const updatedPayment: Payment = {
      ...payment, status: original.paymentMethod === 'cash'
        ? (fullyRefunded ? 'refunded' : 'partially_refunded')
        : 'refund_pending',
    }
    const movements: InventoryMovement[] = []
    const inventoryUpdates: InventoryItem[] = []
    for (const line of refundLines) {
      if (!line.restock) continue
      const current = await db.inventory.get([original.storeId, line.productId])
        ?? { storeId: original.storeId, productId: line.productId, quantityOnHand: 0, rowVersion: 0, updatedAt: now }
      const next = { ...current, quantityOnHand: current.quantityOnHand + line.quantity, rowVersion: current.rowVersion + 1, updatedAt: now }
      inventoryUpdates.push(next)
      movements.push({
        id: newId(), storeId: original.storeId, productId: line.productId,
        deviceId: original.deviceId, employeeId: args.employee.id,
        movementType: 'return', quantityDelta: line.quantity, baseVersion: current.rowVersion,
        orderId: original.id, refundId: refund.id, reason: refund.reason,
        createdAt: now, syncStatus: args.demoMode ? 'local' : 'pending',
      })
    }
    const outboxEvents = args.demoMode ? [] : [
      makeSyncEvent(args.employee, 'refund', refund.id, { refund, order: updatedOrder, payment: updatedPayment, inventoryMovements: movements }),
    ]

    await db.refunds.add(refund)
    await db.orders.put(updatedOrder)
    await db.payments.put(updatedPayment)
    if (inventoryUpdates.length) await db.inventory.bulkPut(inventoryUpdates)
    if (movements.length) await db.inventoryMovements.bulkPut(movements)
    if (outboxEvents.length) await db.syncOutbox.bulkAdd(outboxEvents)
    if (original.paymentMethod === 'cash') {
      const currentShift = await db.shifts.where('deviceId').equals(localDeviceId()).filter((shift) => shift.status === 'open').first()
      if (currentShift) await db.shifts.update(currentShift.id, { expectedCashMinor: Math.max(0, currentShift.expectedCashMinor - amountMinor), syncStatus: args.demoMode ? 'local' : 'pending' })
    }
    return { refund, order: updatedOrder, payment: updatedPayment }
  })
}

export async function adjustInventory(args: { product: Product; employee: Employee; newQuantity: number; reason: string; movementType?: 'receive' | 'count_adjustment' | 'damage' }) {
  if (!Number.isFinite(args.newQuantity) || args.newQuantity < 0) throw new Error('Stock quantity must be zero or more.')
  const now = new Date().toISOString()
  const current = await db.inventory.get([args.product.storeId, args.product.id])
    ?? { storeId: args.product.storeId, productId: args.product.id, quantityOnHand: 0, rowVersion: 0, updatedAt: now }
  const delta = args.newQuantity - current.quantityOnHand
  if (delta === 0) return current
  const movement: InventoryMovement = {
    id: newId(), storeId: args.product.storeId, productId: args.product.id,
    deviceId: localDeviceId(), employeeId: args.employee.id,
    movementType: args.movementType ?? 'count_adjustment', quantityDelta: delta,
    baseVersion: current.rowVersion, reason: args.reason.trim() || 'Manual stock adjustment',
    createdAt: now, syncStatus: 'pending',
  }
  const next = { ...current, quantityOnHand: args.newQuantity, rowVersion: current.rowVersion + 1, updatedAt: now }
  const event = makeSyncEvent(args.employee, 'inventory_movement', movement.id, { movement, inventory: next })
  await db.transaction('rw', [db.inventory, db.inventoryMovements, db.syncOutbox], async () => {
    await db.inventory.put(next)
    await db.inventoryMovements.add(movement)
    await db.syncOutbox.add(event)
  })
  return next
}

async function assertProductIdentifiers(product: Pick<Product, 'id' | 'sku' | 'barcode'>) {
  const rows = await db.products.toArray()
  const sku = product.sku.trim().toLowerCase()
  if (sku && rows.some((row) => row.id !== product.id && row.sku.trim().toLowerCase() === sku)) {
    throw new Error('That SKU is already in use.')
  }
  const barcode = product.barcode?.trim() ?? ''
  if (!isValidBarcode(barcode)) {
    throw new Error('Barcode must be 1–64 letters, numbers, dots, underscores, slashes, or hyphens.')
  }
  const normalized = normalizeBarcode(barcode)
  if (normalized && rows.some((row) => row.id !== product.id && normalizeBarcode(row.barcode ?? '') === normalized)) {
    throw new Error('That barcode is already assigned to another product.')
  }
}

export async function saveProduct(product: Product, employee: Employee, previous?: Product) {
  await assertProductIdentifiers(product)
  const now = new Date().toISOString()
  const saved = { ...product, barcode: product.barcode?.trim() || undefined, rowVersion: previous ? previous.rowVersion + 1 : 1, updatedAt: now, createdAt: previous?.createdAt ?? now }
  const event = makeSyncEvent(employee, 'product', saved.id, { product: saved })
  await db.transaction('rw', [db.products, db.inventory, db.syncOutbox], async () => {
    await db.products.put(saved)
    if (!previous) await db.inventory.put({ storeId: saved.storeId, productId: saved.id, quantityOnHand: 0, rowVersion: 0, updatedAt: now })
    await db.syncOutbox.add(event)
  })
  return saved
}

export async function saveTaxCategory(category: TaxCategory, employee: Employee) {
  await db.taxCategories.put(category)
  await db.syncOutbox.add(makeSyncEvent(employee, 'tax', category.id, { taxCategory: category }))
}

export async function saveEmployee(employee: Employee, actor: Employee) {
  const event = makeSyncEvent(actor, 'employee', employee.id, { employee })
  await db.transaction('rw', [db.employees, db.syncOutbox], async () => {
    await db.employees.put(employee)
    await db.syncOutbox.add(event)
  })
  return event
}

export async function openShift(employee: Employee, openingFloatMinor: number) {
  const existing = await db.shifts.where('status').equals('open').toArray()
  if (existing.some((shift) => shift.deviceId === localDeviceId())) throw new Error('This device already has an open shift.')
  const now = new Date().toISOString()
  const shift: Shift = {
    id: newId(), storeId: employee.storeId || DEMO_STORE_ID, deviceId: localDeviceId(),
    employeeId: employee.id, employeeName: employee.displayName, status: 'open',
    openingFloatMinor, expectedCashMinor: openingFloatMinor, openedAt: now, syncStatus: 'pending',
  }
  await db.transaction('rw', [db.shifts, db.syncOutbox], async () => {
    await db.shifts.add(shift)
    await db.syncOutbox.add(makeSyncEvent(employee, 'shift', shift.id, { shift }))
  })
  return shift
}

export async function closeShift(shift: Shift, employee: Employee, countedCashMinor: number, varianceReason: string) {
  const now = new Date().toISOString()
  const updated: Shift = {
    ...shift, status: 'closed', countedCashMinor,
    varianceMinor: countedCashMinor - shift.expectedCashMinor,
    varianceReason: varianceReason.trim() || undefined,
    closedAt: now, syncStatus: 'pending',
  }
  await db.transaction('rw', [db.shifts, db.syncOutbox], async () => {
    await db.shifts.put(updated)
    await db.syncOutbox.add(makeSyncEvent(employee, 'shift', updated.id, { shift: updated }))
  })
  return updated
}

export async function addNewProduct(args: { name: string; sku: string; barcode?: string; categoryName: string; taxCategory: TaxCategory; priceMinor: number; priceMode: Product['priceMode']; stock: number; employee: Employee }) {
  const now = new Date().toISOString()
  const categoryId = (await db.products.toArray()).find((product) => product.categoryName === args.categoryName)?.categoryId ?? newId()
  const product: Product = {
    id: newId(), storeId: args.employee.storeId, name: args.name.trim(), sku: args.sku.trim(), barcode: args.barcode?.trim() || undefined,
    categoryId, categoryName: args.categoryName.trim(), taxCategoryId: args.taxCategory.id,
    priceMinor: Math.round(args.priceMinor), currencyCode: 'GHS', priceMode: args.priceMode,
    unitName: 'each', active: true, rowVersion: 1, createdAt: now, updatedAt: now,
  }
  await assertProductIdentifiers(product)
  const event = makeSyncEvent(args.employee, 'product', product.id, { product })
  await db.transaction('rw', [db.products, db.inventory, db.inventoryMovements, db.syncOutbox], async () => {
    await db.products.add(product)
    await db.inventory.add({ storeId: product.storeId, productId: product.id, quantityOnHand: args.stock, rowVersion: 1, updatedAt: now })
    if (args.stock > 0) {
      const movement: InventoryMovement = {
        id: newId(), storeId: product.storeId, productId: product.id, deviceId: localDeviceId(), employeeId: args.employee.id,
        movementType: 'opening_balance', quantityDelta: args.stock, baseVersion: 0,
        reason: 'Opening stock', createdAt: now, syncStatus: 'pending',
      }
      await db.inventoryMovements.add(movement)
      await db.syncOutbox.add(makeSyncEvent(args.employee, 'inventory_movement', movement.id, { movement }))
    }
    await db.syncOutbox.add(event)
  })
  return product
}

export function newLocalStoreId() {
  return DEMO_STORE_ID
}
