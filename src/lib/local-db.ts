import Dexie, { type Table } from 'dexie'
import type { Employee, InventoryItem, InventoryMovement, Order, Payment, Product, Refund, Shift, SyncEvent, TaxCategory } from './types'

interface AppMeta {
  key: string
  value: unknown
  updatedAt: string
}

class PosDatabase extends Dexie {
  products!: Table<Product, string>
  taxCategories!: Table<TaxCategory, string>
  orders!: Table<Order, string>
  payments!: Table<Payment, string>
  refunds!: Table<Refund, string>
  inventory!: Table<InventoryItem, [string, string]>
  inventoryMovements!: Table<InventoryMovement, string>
  employees!: Table<Employee, string>
  shifts!: Table<Shift, string>
  syncOutbox!: Table<SyncEvent, string>
  appMeta!: Table<AppMeta, string>

  constructor() {
    super('merchant-pos-pwa')
    this.version(1).stores({
      products: '&id, storeId, categoryId, sku, active, updatedAt',
      taxCategories: '&id, storeId, code, active, effectiveFrom',
      orders: '&id, storeId, createdAt, status, syncStatus, orderNumber',
      payments: '&id, storeId, orderId, method, status, providerReference',
      refunds: '&id, storeId, orderId, status, createdAt',
      inventory: '[storeId+productId], storeId, productId, updatedAt',
      inventoryMovements: '&id, storeId, productId, createdAt, syncStatus',
      employees: '&id, storeId, role, status',
      shifts: '&id, storeId, deviceId, status, openedAt',
      syncOutbox: '&eventId, storeId, eventType, createdAt, status',
      appMeta: '&key',
    })
    this.version(2).stores({
      inventoryMovements: '&id, storeId, productId, createdAt, syncStatus, orderId, refundId',
      syncOutbox: '&eventId, storeId, eventType, entityId, createdAt, status',
    })
  }
}

export const db = new PosDatabase()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const entry = await db.appMeta.get(key)
  return (entry?.value as T | undefined) ?? fallback
}

export async function setMeta(key: string, value: unknown) {
  await db.appMeta.put({ key, value, updatedAt: new Date().toISOString() })
}

export async function clearLocalDemoData() {
  await db.transaction('rw', [db.products, db.taxCategories, db.orders, db.payments, db.refunds, db.inventory, db.inventoryMovements, db.employees, db.shifts, db.syncOutbox, db.appMeta], async () => {
    await Promise.all([
      db.products.clear(), db.taxCategories.clear(), db.orders.clear(), db.payments.clear(),
      db.refunds.clear(), db.inventory.clear(), db.inventoryMovements.clear(), db.employees.clear(),
      db.shifts.clear(), db.syncOutbox.clear(), db.appMeta.clear(),
    ])
  })
}
