import { db } from './local-db'
import { DEMO_DEVICE_ID, DEMO_STORE_ID } from './demo-seed'
import { summarizeLines } from './tax'
import type { CalculatedLine, Employee, InventoryItem, InventoryMovement, Order, Payment, PaymentMethod, PaymentStatus, Product, Refund, RefundLine, Shift, SyncEvent, TaxCategory } from './types'

export function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
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

function allocateOrderNumber(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '').slice(2)
  const key = `pos-order-sequence-${day}`
  const next = Number(localStorage.getItem(key) ?? '1049')
  localStorage.setItem(key, String(next + 1))
  return `S-${day}-${String(next).padStart(4, '0')}`
}

function makeOrder(args: {
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
  const order: Order = {
    id, clientOrderId: newId(), storeId: args.employee.storeId || DEMO_STORE_ID,
    deviceId: localDeviceId(), employeeId: args.employee.id, employeeName: args.employee.displayName,
    shiftId: args.shift?.id, orderNumber: allocateOrderNumber(), status: args.status,
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
  const order = makeOrder({
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
  const order = makeOrder({ employee: args.employee, shift: args.shift, lines: args.lines, paymentMethod: args.method, paymentStatus: 'pending', source: 'local', status: 'pending_payment' })
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
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('The sale could not be found on this device.')
  if (order.status === 'paid') return order
  if (!order.paymentMethod || order.paymentMethod === 'cash') throw new Error('This is not a pending digital payment.')
  const payment = await db.payments.where('orderId').equals(orderId).first()
  if (!payment) throw new Error('The pending payment record is missing.')
  const employee = await db.employees.get(order.employeeId)
  if (!employee) throw new Error('The cashier record is missing.')
  const updatedOrder: Order = {
    ...order, status: 'paid', paymentStatus: 'confirmed', providerReference: details.providerReference,
    providerTransactionId: details.providerTransactionId, syncStatus: 'synced', updatedAt: new Date().toISOString(),
  }
  const updatedPayment: Payment = {
    ...payment, status: 'confirmed', provider: details.provider ?? payment.provider,
    providerReference: details.providerReference, providerTransactionId: details.providerTransactionId,
    confirmedAt: new Date().toISOString(),
  }
  await db.transaction('rw', [db.orders, db.payments, db.inventory, db.inventoryMovements], async () => {
    await moveInventoryForSale(updatedOrder, employee, false)
    await db.orders.put(updatedOrder)
    await db.payments.put(updatedPayment)
  })
  return updatedOrder
}

export async function createRefund(args: {
  order: Order
  employee: Employee
  lines: Array<{ productId: string; quantity: number; restock: boolean }>
  reason: string
  demoMode: boolean
}) {
  const payment = await db.payments.where('orderId').equals(args.order.id).first()
  if (!payment || !args.order.paymentMethod) throw new Error('Original payment details are missing; refund cannot be started.')
  const priorRefunds = await db.refunds.where('orderId').equals(args.order.id).toArray()
  const refundedByProduct = new Map<string, number>()
  for (const refund of priorRefunds) {
    if (refund.status === 'failed') continue
    for (const line of refund.lines) refundedByProduct.set(line.productId, (refundedByProduct.get(line.productId) ?? 0) + line.quantity)
  }
  const refundLines: RefundLine[] = []
  for (const requested of args.lines) {
    const sold = args.order.items.find((line) => line.productId === requested.productId)
    if (!sold) throw new Error('A selected product is not part of this transaction.')
    const available = sold.quantity - (refundedByProduct.get(requested.productId) ?? 0)
    if (requested.quantity <= 0 || requested.quantity > available + 0.0001) throw new Error(`Return quantity exceeds the remaining sold quantity for ${sold.name}.`)
    const fraction = requested.quantity / sold.quantity
    refundLines.push({
      orderLineId: sold.productId, productId: sold.productId, productName: sold.name,
      quantity: requested.quantity, restock: requested.restock,
      itemMinor: Math.round((sold.grossMinor - sold.taxMinor) * fraction),
      taxMinor: Math.round(sold.taxMinor * fraction),
    })
  }
  if (!refundLines.length) throw new Error('Select at least one item to return.')
  const amountMinor = refundLines.reduce((sum, line) => sum + line.itemMinor + line.taxMinor, 0)
  const taxMinor = refundLines.reduce((sum, line) => sum + line.taxMinor, 0)
  const status = args.order.paymentMethod === 'cash' ? 'processed' : 'pending'
  const now = new Date().toISOString()
  const refund: Refund = {
    id: newId(), storeId: args.order.storeId, orderId: args.order.id, paymentId: payment.id,
    orderNumber: args.order.orderNumber, amountMinor, taxMinor, method: args.order.paymentMethod,
    status, reason: args.reason.trim() || 'Customer return', lines: refundLines, createdAt: now,
    syncStatus: args.demoMode ? 'local' : 'pending',
  }
  const newlyConfirmed = status === 'processed' ? amountMinor : 0
  const confirmedRefundTotal = args.order.refundedMinor + newlyConfirmed
  const fullyRefunded = confirmedRefundTotal >= args.order.totalMinor
  const updatedOrder: Order = {
    ...args.order, refundedMinor: confirmedRefundTotal,
    status: fullyRefunded ? 'refunded' : confirmedRefundTotal > 0 || status !== 'processed' ? 'partially_refunded' : 'paid',
    paymentStatus: args.order.paymentMethod === 'cash'
      ? (fullyRefunded ? 'refunded' : 'partially_refunded')
      : 'refund_pending',
    syncStatus: args.demoMode ? args.order.syncStatus : 'pending', updatedAt: now,
  }
  const updatedPayment: Payment = {
    ...payment, status: args.order.paymentMethod === 'cash'
      ? (fullyRefunded ? 'refunded' : 'partially_refunded')
      : 'refund_pending',
  }
  const movements: InventoryMovement[] = []
  const inventoryUpdates: InventoryItem[] = []
  for (const line of refundLines) {
    if (!line.restock) continue
    const current = await db.inventory.get([args.order.storeId, line.productId])
      ?? { storeId: args.order.storeId, productId: line.productId, quantityOnHand: 0, rowVersion: 0, updatedAt: now }
    const next = { ...current, quantityOnHand: current.quantityOnHand + line.quantity, rowVersion: current.rowVersion + 1, updatedAt: now }
    inventoryUpdates.push(next)
    movements.push({
      id: newId(), storeId: args.order.storeId, productId: line.productId,
      deviceId: args.order.deviceId, employeeId: args.employee.id,
      movementType: 'return', quantityDelta: line.quantity, baseVersion: current.rowVersion,
      orderId: args.order.id, refundId: refund.id, reason: refund.reason,
      createdAt: now, syncStatus: args.demoMode ? 'local' : 'pending',
    })
  }
  const outboxEvents = args.demoMode ? [] : [
    makeSyncEvent(args.employee, 'refund', refund.id, { refund, order: updatedOrder, payment: updatedPayment, inventoryMovements: movements }),
  ]
  await db.transaction('rw', [db.orders, db.payments, db.refunds, db.inventory, db.inventoryMovements, db.syncOutbox, db.shifts], async () => {
    await db.refunds.add(refund)
    await db.orders.put(updatedOrder)
    await db.payments.put(updatedPayment)
    if (inventoryUpdates.length) await db.inventory.bulkPut(inventoryUpdates)
    if (movements.length) await db.inventoryMovements.bulkPut(movements)
    if (outboxEvents.length) await db.syncOutbox.bulkAdd(outboxEvents)
    if (args.order.paymentMethod === 'cash') {
      const currentShift = await db.shifts.where('deviceId').equals(localDeviceId()).filter((shift) => shift.status === 'open').first()
      if (currentShift) await db.shifts.update(currentShift.id, { expectedCashMinor: Math.max(0, currentShift.expectedCashMinor - amountMinor), syncStatus: args.demoMode ? 'local' : 'pending' })
    }
  })
  return { refund, order: updatedOrder, payment: updatedPayment }
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

export async function saveProduct(product: Product, employee: Employee, previous?: Product) {
  const now = new Date().toISOString()
  const saved = { ...product, rowVersion: previous ? previous.rowVersion + 1 : 1, updatedAt: now, createdAt: previous?.createdAt ?? now }
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
  await db.employees.put(employee)
  await db.syncOutbox.add(makeSyncEvent(actor, 'employee', employee.id, { employee }))
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

export async function addNewProduct(args: { name: string; sku: string; categoryName: string; taxCategory: TaxCategory; priceMinor: number; priceMode: Product['priceMode']; stock: number; employee: Employee }) {
  const now = new Date().toISOString()
  const existing = await db.products.where('sku').equals(args.sku).first()
  if (existing) throw new Error('That SKU is already in use.')
  const categoryId = (await db.products.toArray()).find((product) => product.categoryName === args.categoryName)?.categoryId ?? newId()
  const product: Product = {
    id: newId(), storeId: args.employee.storeId, name: args.name.trim(), sku: args.sku.trim(),
    categoryId, categoryName: args.categoryName.trim(), taxCategoryId: args.taxCategory.id,
    priceMinor: Math.round(args.priceMinor), currencyCode: 'GHS', priceMode: args.priceMode,
    unitName: 'each', active: true, rowVersion: 1, createdAt: now, updatedAt: now,
  }
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
