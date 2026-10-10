import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_EMPLOYEES, DEMO_PRODUCTS, ensureDemoData } from './demo-seed'
import { db } from './local-db'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('demo employee refund-limit defaults', () => {
  it('seeds cashier 0, manager GHS 500.00, and owner Number.MAX_SAFE_INTEGER pesewas', async () => {
    await ensureDemoData()
    const cashier = await db.employees.get(DEMO_EMPLOYEES[0].id)
    const manager = await db.employees.get(DEMO_EMPLOYEES[1].id)
    const owner = await db.employees.get(DEMO_EMPLOYEES[2].id)

    expect(cashier?.refundLimitMinor).toBe(0)
    expect(manager?.refundLimitMinor).toBe(50_000)
    expect(owner?.refundLimitMinor).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('upgrades the previous demo defaults without overwriting a custom limit', async () => {
    await db.appMeta.put({ key: 'demo-seeded-v1', value: true, updatedAt: new Date().toISOString() })
    await db.products.put(DEMO_PRODUCTS[0])
    await db.employees.bulkPut([
      { ...DEMO_EMPLOYEES[0], refundLimitMinor: 0 },
      { ...DEMO_EMPLOYEES[1], refundLimitMinor: 100_000 },
      { ...DEMO_EMPLOYEES[2], refundLimitMinor: null },
    ])

    await ensureDemoData()

    expect((await db.employees.get(DEMO_EMPLOYEES[0].id))?.refundLimitMinor).toBe(0)
    expect((await db.employees.get(DEMO_EMPLOYEES[1].id))?.refundLimitMinor).toBe(50_000)
    expect((await db.employees.get(DEMO_EMPLOYEES[2].id))?.refundLimitMinor).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('preserves user-configured demo limits that are not legacy defaults', async () => {
    await db.appMeta.put({ key: 'demo-seeded-v1', value: true, updatedAt: new Date().toISOString() })
    await db.products.put(DEMO_PRODUCTS[0])
    await db.employees.bulkPut([
      { ...DEMO_EMPLOYEES[0], refundLimitMinor: 0 },
      { ...DEMO_EMPLOYEES[1], refundLimitMinor: 12_500 },
      { ...DEMO_EMPLOYEES[2], refundLimitMinor: 100_000 },
    ])

    await ensureDemoData()

    expect((await db.employees.get(DEMO_EMPLOYEES[1].id))?.refundLimitMinor).toBe(12_500)
    expect((await db.employees.get(DEMO_EMPLOYEES[2].id))?.refundLimitMinor).toBe(100_000)
  })
})
