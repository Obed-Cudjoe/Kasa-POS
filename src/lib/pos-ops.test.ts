import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase-browser', () => ({ getAccessToken: vi.fn(async () => 'synthetic-test-token') }))

import { db } from './local-db'
import { DEMO_DEVICE_ID, DEMO_EMPLOYEES, DEMO_PRODUCTS, DEMO_STORE_ID, DEMO_TAX_CATEGORIES } from './demo-seed'
import { closeShift, completePaidSale, createPendingDigitalOrder, createRefund, markDigitalPaymentConfirmed, newId, openShift } from './pos-ops'
import { pushOutbox } from './sync-client'
import { calculateLine, summarizeLines } from './tax'
import type { Employee, Product } from './types'

const TEST_DEVICE_A = '10000000-0000-4000-8000-00000000a001'
const TEST_DEVICE_B = '10000000-0000-4000-8000-00000000b002'
const cashier: Employee = { ...DEMO_EMPLOYEES[0], storeId: DEMO_STORE_ID }
const manager: Employee = { ...DEMO_EMPLOYEES[1], storeId: DEMO_STORE_ID }
const relevantProductIds = [0, 5, 15, 19].map((index) => DEMO_PRODUCTS[index].id)

function lineFor(product: Product, quantity = 1) {
  const tax = DEMO_TAX_CATEGORIES.find((category) => category.id === product.taxCategoryId)
  if (!tax) throw new Error(`Missing test tax category for ${product.sku}`)
  return calculateLine(product, quantity, tax)
}

function getProduct(index: number) {
  const product = DEMO_PRODUCTS[index]
  if (!product) throw new Error(`Missing demo product ${index}`)
  return product
}

async function seedInventory(productIds = relevantProductIds, quantity = 500) {
  await db.inventory.bulkPut(productIds.map((productId) => ({
    storeId: DEMO_STORE_ID, productId, quantityOnHand: quantity, rowVersion: 1, updatedAt: new Date().toISOString(),
  })))
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  const storage = memoryStorage()
  storage.setItem('pos-device-id', TEST_DEVICE_A)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  await db.employees.bulkPut([cashier, manager])
  await seedInventory()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('local POS simulation', () => {
  it('records 50 labelled synthetic sales across cash, card and mobile money, with mixed tax profiles', async () => {
    const modes = ['cash', 'card', 'momo'] as const
    const productIndexes = [0, 5, 15, 19]
    for (let index = 0; index < 50; index += 1) {
      const method = modes[index % modes.length]
      const first = getProduct(productIndexes[index % productIndexes.length])
      const selected = [lineFor(first, index % 7 === 0 ? 2 : 1)]
      if (index % 5 === 0) selected.push(lineFor(getProduct(productIndexes[(index + 1) % productIndexes.length]), 1))
      const total = summarizeLines(selected).totalMinor
      await completePaidSale({
        employee: cashier,
        lines: selected,
        paymentMethod: method,
        paymentStatus: method === 'cash' ? 'confirmed' : 'demo_simulated',
        source: 'demo',
        cashTenderedMinor: method === 'cash' ? total + 500 : undefined,
        providerNetwork: method === 'momo' ? 'Demo · MTN' : method === 'card' ? 'Demo · card' : undefined,
      })
    }

    const orders = await db.orders.toArray()
    const payments = await db.payments.toArray()
    expect(orders).toHaveLength(50)
    expect(payments).toHaveLength(50)
    expect(new Set(orders.map((order) => order.orderNumber)).size).toBe(50)
    expect(new Set(payments.map((payment) => payment.method))).toEqual(new Set(['cash', 'card', 'momo']))
    expect(payments.filter((payment) => payment.status === 'demo_simulated')).toHaveLength(33)
    expect(orders.every((order) => order.source === 'demo' && order.totalMinor === order.subtotalMinor + order.taxMinor)).toBe(true)
    expect(await db.syncOutbox.count()).toBe(0)
    expect((await db.inventory.toArray()).every((item) => item.quantityOnHand >= 0)).toBe(true)
  })

  it('reconciles cash tender change, till float and a cash return', async () => {
    const product = getProduct(0)
    const line = lineFor(product)
    const shift = await openShift(cashier, 10_000)
    const sale = await completePaidSale({
      employee: cashier, shift, lines: [line], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'demo',
      cashTenderedMinor: line.grossMinor + 500,
    })
    expect(sale.order.changeMinor).toBe(500)
    expect((await db.shifts.get(shift.id))?.expectedCashMinor).toBe(10_000 + line.grossMinor)
    const refund = await createRefund({
      order: sale.order, employee: manager, lines: [{ productId: product.id, quantity: 1, restock: false }],
      reason: 'synthetic cash till return', demoMode: true,
    })
    expect(refund.order.status).toBe('refunded')
    expect((await db.shifts.get(shift.id))?.expectedCashMinor).toBe(10_000)
    const closed = await closeShift(shift, cashier, 10_000, '')
    expect(closed.varianceMinor).toBe(0)
    expect(closed.status).toBe('closed')
  })

  it('allocates atomic, device-scoped receipt numbers under concurrent local checkout', async () => {
    const product = getProduct(0)
    const lines = [lineFor(product)]
    const total = summarizeLines(lines).totalMinor
    const sale = () => completePaidSale({
      employee: cashier, lines, paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'demo', cashTenderedMinor: total,
    })
    const sameDevice = await Promise.all(Array.from({ length: 12 }, () => sale()))
    expect(new Set(sameDevice.map(({ order }) => order.orderNumber)).size).toBe(12)

    const storage = globalThis.localStorage as ReturnType<typeof memoryStorage>
    storage.setItem('pos-device-id', TEST_DEVICE_B)
    const secondDevice = await sale()
    expect(secondDevice.order.orderNumber).toContain('B002')
    expect(sameDevice[0].order.orderNumber).toContain('A001')
    expect(secondDevice.order.orderNumber).not.toBe(sameDevice[0].order.orderNumber)
  })

  it('finalizes the same confirmed digital payment once under concurrent verification', async () => {
    const product = getProduct(0)
    const pending = await createPendingDigitalOrder({ employee: cashier, lines: [lineFor(product)], method: 'momo', network: 'mtn' })
    const confirmed = await Promise.all([
      markDigitalPaymentConfirmed(pending.order.id, { providerReference: 'SYNTHETIC-PROVIDER-REF' }),
      markDigitalPaymentConfirmed(pending.order.id, { providerReference: 'SYNTHETIC-PROVIDER-REF' }),
    ])
    expect(confirmed.every((order) => order.status === 'paid')).toBe(true)
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(499)
    expect(await db.inventoryMovements.where('orderId').equals(pending.order.id).count()).toBe(1)
    expect((await db.payments.get(pending.payment.id))?.status).toBe('confirmed')
  })

  it('preserves exact full-sale gross and tax across multiple partial cash refunds', async () => {
    const product = getProduct(0)
    const sale = await completePaidSale({
      employee: cashier, lines: [lineFor(product)], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'demo',
      cashTenderedMinor: lineFor(product).grossMinor,
    })
    const first = await createRefund({
      order: sale.order, employee: manager, lines: [{ productId: product.id, quantity: 0.333, restock: true }],
      reason: 'synthetic partial return', demoMode: true,
    })
    const second = await createRefund({
      order: first.order, employee: manager, lines: [{ productId: product.id, quantity: 0.667, restock: true }],
      reason: 'synthetic remainder return', demoMode: true,
    })
    const refunds = await db.refunds.where('orderId').equals(sale.order.id).toArray()
    const refundedGross = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)
    const refundedTax = refunds.reduce((sum, refund) => sum + refund.taxMinor, 0)
    expect(refundedGross).toBe(sale.order.totalMinor)
    expect(refundedTax).toBe(sale.order.taxMinor)
    expect(second.order.status).toBe('refunded')
    expect(second.order.refundedMinor).toBe(sale.order.totalMinor)
    expect(second.payment.status).toBe('refunded')
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(500)
  })

  it('enforces employee refund ceilings and serializes duplicate full-refund attempts', async () => {
    const product = getProduct(0)
    const line = lineFor(product)
    const sale = await completePaidSale({
      employee: cashier, lines: [line], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'demo', cashTenderedMinor: line.grossMinor,
    })
    await expect(createRefund({
      order: sale.order, employee: cashier, lines: [{ productId: product.id, quantity: 1, restock: true }],
      reason: 'zero-limit synthetic refund', demoMode: true,
    })).rejects.toThrow(/authorization limit/i)
    await expect(createRefund({
      order: sale.order, employee: { ...manager, refundLimitMinor: line.grossMinor - 1 },
      lines: [{ productId: product.id, quantity: 1, restock: true }], reason: 'over-limit synthetic refund', demoMode: true,
    })).rejects.toThrow(/authorization limit/i)

    const attempts = await Promise.allSettled([
      createRefund({ order: sale.order, employee: manager, lines: [{ productId: product.id, quantity: 1, restock: true }], reason: 'synthetic attempt A', demoMode: true }),
      createRefund({ order: sale.order, employee: manager, lines: [{ productId: product.id, quantity: 1, restock: true }], reason: 'synthetic attempt B', demoMode: true }),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(await db.refunds.where('orderId').equals(sale.order.id).count()).toBe(1)
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(500)
  })

  it('allows a cashier refund only when the configured per-transaction ceiling covers it', async () => {
    const product = getProduct(0)
    const line = lineFor(product)
    const sale = await completePaidSale({
      employee: cashier, lines: [line], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'demo', cashTenderedMinor: line.grossMinor,
    })
    const limitedCashier = { ...cashier, refundLimitMinor: line.grossMinor }
    const refund = await createRefund({
      order: sale.order, employee: limitedCashier, lines: [{ productId: product.id, quantity: 1, restock: true }],
      reason: 'within-limit synthetic refund', demoMode: true,
    })
    expect(refund.refund.amountMinor).toBe(line.grossMinor)
    expect(refund.order.status).toBe('refunded')
  })

  it('keeps a mobile-money reversal pending until a provider status exists', async () => {
    const product = getProduct(0)
    const pending = await createPendingDigitalOrder({ employee: cashier, lines: [lineFor(product)], method: 'momo', network: 'mtn' })
    await markDigitalPaymentConfirmed(pending.order.id, { providerReference: 'SYNTHETIC-PROVIDER-REF' })
    const paidOrder = await db.orders.get(pending.order.id)
    if (!paidOrder) throw new Error('Expected the synthetic order to exist.')
    const result = await createRefund({
      order: paidOrder, employee: manager, lines: [{ productId: product.id, quantity: 1, restock: true }],
      reason: 'synthetic MoMo return', demoMode: true,
    })
    expect(result.refund.status).toBe('pending')
    expect(result.order.status).toBe('partially_refunded')
    expect(result.order.refundedMinor).toBe(0)
    expect(result.payment.status).toBe('refund_pending')
    expect(await db.syncOutbox.count()).toBe(1)
  })
})

describe('offline outbox simulation (mocked HTTP only)', () => {
  it('retains 10 offline sales and two refunds across a network loss, then records ack/conflict without silent loss', async () => {
    const product = getProduct(0)
    const line = lineFor(product)
    const total = line.grossMinor
    const sales = []
    for (let index = 0; index < 10; index += 1) {
      sales.push(await completePaidSale({
        employee: cashier, lines: [line], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'local', cashTenderedMinor: total,
      }))
    }
    for (const sale of sales.slice(0, 2)) {
      await createRefund({
        order: sale.order, employee: manager, lines: [{ productId: product.id, quantity: 1, restock: true }],
        reason: 'offline synthetic return', demoMode: false,
      })
    }
    expect(await db.orders.count()).toBe(10)
    expect(await db.refunds.count()).toBe(2)
    expect(await db.syncOutbox.where('status').equals('pending').count()).toBe(12)
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(492)

    const events = await db.syncOutbox.toArray()
    const conflictEvent = events.find((event) => event.eventType === 'refund')
    const duplicateEvent = events.find((event) => event.eventType === 'order')
    if (!conflictEvent || !duplicateEvent) throw new Error('Expected synthetic refund and order events.')
    const appliedByMockServer = new Set<string>()
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('synthetic network loss'))
      .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body ?? '{}')) as { events?: Array<{ eventId: string }> }
        return {
          ok: true,
          json: async () => ({
            results: (requestBody.events ?? []).map((event) => {
              if (event.eventId === conflictEvent.eventId) return { eventId: event.eventId, status: 'conflict', error: 'synthetic inventory conflict' }
              appliedByMockServer.add(event.eventId)
              return { eventId: event.eventId, status: 'accepted' }
            }),
          }),
        } as Response
      }))

    await expect(pushOutbox()).rejects.toThrow(/synthetic network loss/)
    expect(await db.syncOutbox.where('status').equals('pending').count()).toBe(12)
    const result = await pushOutbox()
    expect(result.sent).toBe(11)
    expect(result.pending).toBe(0)
    expect(result.conflicts).toHaveLength(1)
    expect(appliedByMockServer.size).toBe(11)
    expect((await db.syncOutbox.get(conflictEvent.eventId))?.status).toBe('conflict')
    expect(await db.orders.count()).toBe(10)
    expect(await db.refunds.count()).toBe(2)
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(492)

    // Simulate a client restart that accidentally marks one acknowledged event pending again.
    await db.syncOutbox.update(duplicateEvent.eventId, { status: 'pending' })
    const duplicate = await pushOutbox()
    expect(duplicate.sent).toBe(1)
    expect(appliedByMockServer.size).toBe(11)
    expect((await db.inventory.get([DEMO_STORE_ID, product.id]))?.quantityOnHand).toBe(492)
    const retry = await pushOutbox()
    expect(retry.sent).toBe(0)
    expect(retry.pending).toBe(0)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('does not resend an acknowledged event unless it is explicitly returned to the local queue', async () => {
    const product = getProduct(0)
    const line = lineFor(product)
    const sale = await completePaidSale({
      employee: cashier, lines: [line], paymentMethod: 'cash', paymentStatus: 'confirmed', source: 'local', cashTenderedMinor: line.grossMinor,
    })
    const appliedByTestServer = new Set<string>()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}')) as { events?: Array<{ eventId: string }> }
      const results = (requestBody.events ?? []).map((event) => {
        appliedByTestServer.add(event.eventId)
        return { eventId: event.eventId, status: 'accepted' }
      })
      return { ok: true, json: async () => ({ results }) } as Response
    }))
    await pushOutbox()
    expect(appliedByTestServer.size).toBe(1)
    await pushOutbox()
    expect(appliedByTestServer.size).toBe(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect((await db.orders.get(sale.order.id))?.syncStatus).toBe('synced')
  })
})

describe('identifier generation', () => {
  it('produces RFC 4122 version-4 UUIDs without Math.random fallback', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('keeps the unconfigured local fallback visibly demo-scoped', () => {
    expect(DEMO_DEVICE_ID).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
