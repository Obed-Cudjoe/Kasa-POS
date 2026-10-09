import { db, getMeta, setMeta } from './local-db'
import { calculateLine, summarizeLines } from './tax'
import type { CalculatedLine, Employee, InventoryItem, Order, Payment, Product, Refund, TaxCategory } from './types'

export const DEMO_ID_PREFIX = '2f5b0c90-4c2f-4c3b-8db6-3b67d0e2'
export const demoUuid = (sequence: number) => `${DEMO_ID_PREFIX}${String(sequence).padStart(4, '0')}`

export const DEMO_STORE_ID = '2f5b0c90-4c2f-4c3b-8db6-3b67d0e10001'
export const DEMO_DEVICE_ID = '2f5b0c90-4c2f-4c3b-8db6-3b67d0e10002'
export const DEMO_EMPLOYEES: Employee[] = [
  { id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e10011', storeId: DEMO_STORE_ID, displayName: 'Ama Mensah', role: 'cashier', status: 'active', createdAt: new Date().toISOString() },
  { id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e10012', storeId: DEMO_STORE_ID, displayName: 'Kojo Owusu', role: 'manager', status: 'active', createdAt: new Date().toISOString() },
  { id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e10013', storeId: DEMO_STORE_ID, displayName: 'Akosua Boateng', role: 'owner', status: 'active', createdAt: new Date().toISOString() },
]

export const DEMO_TAX_CATEGORIES: TaxCategory[] = [
  {
    id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', storeId: DEMO_STORE_ID, code: 'STANDARD-GH-DEMO', name: 'Standard rated · Ghana demo',
    treatment: 'standard_rated', defaultPriceMode: 'inclusive', effectiveFrom: '2026-01-01', active: true,
    components: [
      { id: 'vat-15', code: 'VAT', name: 'VAT 15%', ratePercent: 15, method: 'same_base', order: 1 },
      { id: 'nhil-25', code: 'NHIL', name: 'NHIL 2.5%', ratePercent: 2.5, method: 'same_base', order: 2 },
      { id: 'getfund-25', code: 'GETFUND', name: 'GETFund 2.5%', ratePercent: 2.5, method: 'same_base', order: 3 },
    ],
  },
  {
    id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28002', storeId: DEMO_STORE_ID, code: 'ZERO-DEMO', name: 'Zero-rated · demo',
    treatment: 'zero_rated', defaultPriceMode: 'inclusive', effectiveFrom: '2026-01-01', active: true, components: [],
  },
  {
    id: '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28003', storeId: DEMO_STORE_ID, code: 'EXEMPT-DEMO', name: 'Exempt · demo',
    treatment: 'exempt', defaultPriceMode: 'inclusive', effectiveFrom: '2026-01-01', active: true, components: [],
  },
]

const productRows: Array<[string, string, string, number, number, string, 'inclusive' | 'exclusive']> = [
  ['P-001', 'Rice · 1 kg', 'Groceries', 2500, 18, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-002', 'Cooking oil · 1 L', 'Groceries', 3200, 9, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-003', 'Tomato paste', 'Groceries', 800, 22, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-004', 'Mineral water · 500 ml', 'Drinks', 500, 36, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-005', 'Soap bar', 'Household', 700, 15, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-006', 'Milk powder · 400 g', 'Groceries', 1800, 7, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'exclusive'],
  ['P-007', 'Sugar · 1 kg', 'Groceries', 1400, 12, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-008', 'Maize meal · 1 kg', 'Groceries', 1200, 17, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-009', 'Sardines · tin', 'Groceries', 1000, 20, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-010', 'Tea bags · 25 pack', 'Groceries', 1600, 6, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-011', 'Bottled juice · 1 L', 'Drinks', 2100, 5, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'exclusive'],
  ['P-012', 'Laundry powder · 500 g', 'Household', 1900, 8, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-013', 'Toilet tissue · 4 pack', 'Household', 1500, 11, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-014', 'Biscuits · family pack', 'Snacks', 900, 23, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-015', 'Groundnuts · 250 g', 'Snacks', 1100, 14, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-016', 'Eggs · half crate', 'Fresh food', 4200, 4, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28002', 'inclusive'],
  ['P-017', 'Fresh tomatoes · basket', 'Fresh food', 2800, 10, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28002', 'inclusive'],
  ['P-018', 'Bottled water · 1.5 L', 'Drinks', 900, 19, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-019', 'Matches · box', 'Household', 300, 42, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-020', 'Salt · 1 kg', 'Groceries', 600, 25, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28003', 'inclusive'],
  ['P-021', 'Canned beans', 'Groceries', 1300, 13, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-022', 'Corn flakes · 500 g', 'Groceries', 2600, 3, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
  ['P-023', 'Dishwashing liquid', 'Household', 1700, 7, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'exclusive'],
  ['P-024', 'Chocolate bar', 'Snacks', 450, 28, '2f5b0c90-4c2f-4c3b-8db6-3b67d0e28001', 'inclusive'],
]

const DEMO_CATEGORY_IDS: Record<string, string> = {
  Groceries: demoUuid(9001), Drinks: demoUuid(9002), Household: demoUuid(9003),
  Snacks: demoUuid(9004), 'Fresh food': demoUuid(9005),
}

export const DEMO_PRODUCTS: Product[] = productRows.map(([sku, name, categoryName, priceMinor, , taxCategoryId, priceMode], index) => ({
  id: demoUuid(1001 + index),
  storeId: DEMO_STORE_ID,
  name,
  sku,
  categoryId: DEMO_CATEGORY_IDS[categoryName],
  categoryName,
  taxCategoryId,
  priceMinor,
  currencyCode: 'GHS',
  priceMode,
  unitName: 'each',
  active: true,
  rowVersion: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}))

function sampleLine(productId: string, quantity: number): CalculatedLine {
  const product = DEMO_PRODUCTS.find((item) => item.id === productId)!
  const category = DEMO_TAX_CATEGORIES.find((item) => item.id === product.taxCategoryId)!
  return calculateLine(product, quantity, category)
}

function makeSampleOrder(orderNumber: string, lines: CalculatedLine[], method: Order['paymentMethod'], status: Order['paymentStatus'], ageMinutes: number, source: Order['source'] = 'demo'): Order {
  const totals = summarizeLines(lines)
  const createdAt = new Date(Date.now() - ageMinutes * 60_000).toISOString()
  return {
    id: demoUuid(3000 + Number(orderNumber.slice(-4)) - 1040),
    clientOrderId: demoUuid(4000 + Number(orderNumber.slice(-4)) - 1040),
    storeId: DEMO_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    employeeId: DEMO_EMPLOYEES[0].id,
    employeeName: DEMO_EMPLOYEES[0].displayName,
    shiftId: demoUuid(2001),
    orderNumber,
    status: status === 'refunded' ? 'refunded' : status === 'refund_pending' ? 'partially_refunded' : status === 'confirmed' || status === 'demo_simulated' ? 'paid' : 'pending_payment',
    currencyCode: 'GHS',
    subtotalMinor: totals.subtotalMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    items: lines,
    paymentMethod: method,
    paymentStatus: status,
    providerReference: method === 'momo' ? `DEMO-MOMO-${orderNumber}` : method === 'card' ? `DEMO-CARD-${orderNumber}` : undefined,
    refundedMinor: status === 'refunded' ? totals.totalMinor : 0,
    createdAt,
    updatedAt: createdAt,
    localCreatedAt: createdAt,
    syncStatus: 'synced',
    source,
  }
}

export const DEMO_ORDERS: Order[] = [
  makeSampleOrder('A-1048', [sampleLine(DEMO_PRODUCTS[0].id, 2), sampleLine(DEMO_PRODUCTS[2].id, 1), sampleLine(DEMO_PRODUCTS[3].id, 2)], 'cash', 'confirmed', 11),
  makeSampleOrder('A-1047', [sampleLine(DEMO_PRODUCTS[1].id, 1), sampleLine(DEMO_PRODUCTS[4].id, 1)], 'momo', 'refund_pending', 38),
  makeSampleOrder('A-1046', [sampleLine(DEMO_PRODUCTS[6].id, 2), sampleLine(DEMO_PRODUCTS[8].id, 3), sampleLine(DEMO_PRODUCTS[13].id, 2)], 'card', 'demo_simulated', 72),
  makeSampleOrder('A-1045', [sampleLine(DEMO_PRODUCTS[15].id, 1), sampleLine(DEMO_PRODUCTS[17].id, 2)], 'cash', 'refunded', 105),
  makeSampleOrder('A-1044', [sampleLine(DEMO_PRODUCTS[5].id, 1), sampleLine(DEMO_PRODUCTS[9].id, 1)], 'momo', 'demo_simulated', 148),
  makeSampleOrder('A-1043', [sampleLine(DEMO_PRODUCTS[11].id, 2), sampleLine(DEMO_PRODUCTS[12].id, 1)], 'cash', 'confirmed', 204),
  makeSampleOrder('A-1042', [sampleLine(DEMO_PRODUCTS[20].id, 1), sampleLine(DEMO_PRODUCTS[19].id, 2)], 'card', 'demo_simulated', 260),
  makeSampleOrder('A-1041', [sampleLine(DEMO_PRODUCTS[22].id, 1), sampleLine(DEMO_PRODUCTS[23].id, 4)], 'momo', 'demo_simulated', 318),
]

export const DEMO_PAYMENTS: Payment[] = DEMO_ORDERS.map((order) => ({
  id: demoUuid(5000 + Number(order.orderNumber.slice(-4)) - 1040),
  orderId: order.id,
  storeId: DEMO_STORE_ID,
  deviceId: DEMO_DEVICE_ID,
  method: order.paymentMethod!,
  status: order.paymentStatus!,
  amountMinor: order.totalMinor,
  currencyCode: order.currencyCode,
  provider: order.paymentMethod === 'cash' ? 'cash' : 'demo',
  providerNetwork: order.paymentMethod === 'momo' ? 'Demo · not routed' : undefined,
  providerReference: order.providerReference,
  idempotencyKey: demoUuid(6000 + Number(order.orderNumber.slice(-4)) - 1040),
  createdAt: order.createdAt,
  confirmedAt: order.paymentStatus === 'confirmed' || order.paymentStatus === 'refunded' ? order.createdAt : undefined,
}))

const refundedOrder = DEMO_ORDERS.find((order) => order.orderNumber === 'A-1045')!
const pendingRefundOrder = DEMO_ORDERS.find((order) => order.orderNumber === 'A-1047')!
export const DEMO_REFUNDS: Refund[] = [
  {
    id: demoUuid(7001), storeId: DEMO_STORE_ID, orderId: refundedOrder.id,
    paymentId: DEMO_PAYMENTS.find((payment) => payment.orderId === refundedOrder.id)?.id,
    orderNumber: refundedOrder.orderNumber, amountMinor: refundedOrder.totalMinor,
    taxMinor: refundedOrder.taxMinor, method: refundedOrder.paymentMethod!, status: 'processed',
    reason: 'Demo: full return, items saleable',
    lines: refundedOrder.items.map((line) => ({
      orderLineId: line.productId, productId: line.productId, productName: line.name,
      quantity: line.quantity, restock: true, itemMinor: line.grossMinor - line.taxMinor, taxMinor: line.taxMinor,
    })),
    createdAt: refundedOrder.createdAt, syncStatus: 'synced',
  },
  {
    id: demoUuid(7002), storeId: DEMO_STORE_ID, orderId: pendingRefundOrder.id,
    paymentId: DEMO_PAYMENTS.find((payment) => payment.orderId === pendingRefundOrder.id)?.id,
    orderNumber: pendingRefundOrder.orderNumber,
    amountMinor: Math.round((pendingRefundOrder.items[0]?.grossMinor ?? 0) / 2),
    taxMinor: Math.round((pendingRefundOrder.items[0]?.taxMinor ?? 0) / 2), method: 'momo', status: 'pending',
    reason: 'Demo: partial mobile-money reversal; provider not contacted',
    lines: pendingRefundOrder.items.slice(0, 1).map((line) => ({
      orderLineId: line.productId, productId: line.productId, productName: line.name,
      quantity: line.quantity / 2, restock: true,
      itemMinor: Math.round((line.grossMinor - line.taxMinor) / 2), taxMinor: Math.round(line.taxMinor / 2),
    })),
    createdAt: pendingRefundOrder.createdAt, syncStatus: 'pending',
  },
]

export async function ensureDemoData() {
  if (typeof window === 'undefined') return
  const seeded = await getMeta<boolean>('demo-seeded-v1', false)
  const count = await db.products.count()
  if (seeded && count) return

  const categories = [...new Set(DEMO_PRODUCTS.map((product) => product.categoryId))]
  const inventory: InventoryItem[] = DEMO_PRODUCTS.map((product) => {
    const row = productRows.find((item) => item[0] === product.sku)!
    return { storeId: DEMO_STORE_ID, productId: product.id, quantityOnHand: row[4], rowVersion: 1, updatedAt: new Date().toISOString() }
  })

  await db.transaction('rw', [db.products, db.taxCategories, db.employees, db.inventory, db.orders, db.payments, db.refunds, db.shifts, db.appMeta], async () => {
    await db.taxCategories.bulkPut(DEMO_TAX_CATEGORIES)
    await db.products.bulkPut(DEMO_PRODUCTS)
    await db.employees.bulkPut(DEMO_EMPLOYEES)
    await db.inventory.bulkPut(inventory)
    if (await db.orders.count() === 0) await db.orders.bulkPut(DEMO_ORDERS)
    if (await db.payments.count() === 0) await db.payments.bulkPut(DEMO_PAYMENTS)
    if (await db.refunds.count() === 0) await db.refunds.bulkPut(DEMO_REFUNDS)
    if (await db.shifts.count() === 0) {
      await db.shifts.add({
        id: demoUuid(2001), storeId: DEMO_STORE_ID, deviceId: DEMO_DEVICE_ID,
        employeeId: DEMO_EMPLOYEES[0].id, employeeName: DEMO_EMPLOYEES[0].displayName,
        status: 'closed', openingFloatMinor: 20_000, expectedCashMinor: 64_500,
        countedCashMinor: 64_000, varianceMinor: -500, varianceReason: 'Demo variance',
        openedAt: new Date(Date.now() - 8 * 60 * 60_000).toISOString(),
        closedAt: new Date(Date.now() - 60 * 60_000).toISOString(), syncStatus: 'synced',
      })
      await db.shifts.add({
        id: demoUuid(2002), storeId: DEMO_STORE_ID, deviceId: DEMO_DEVICE_ID,
        employeeId: DEMO_EMPLOYEES[0].id, employeeName: DEMO_EMPLOYEES[0].displayName,
        status: 'open', openingFloatMinor: 20_000, expectedCashMinor: 20_000,
        openedAt: new Date().toISOString(), syncStatus: 'local',
      })
    }
    await db.appMeta.put({ key: 'demo-categories', value: categories, updatedAt: new Date().toISOString() })
  })
  await setMeta('demo-seeded-v1', true)
}
