export type UserRole = 'owner' | 'manager' | 'cashier'
export type TaxTreatment = 'standard_rated' | 'zero_rated' | 'exempt' | 'out_of_scope'
export type PriceMode = 'inclusive' | 'exclusive'
export type PaymentMethod = 'cash' | 'card' | 'momo'
export type PaymentStatus = 'initiated' | 'pending' | 'confirmed' | 'failed' | 'refund_pending' | 'partially_refunded' | 'refunded' | 'demo_simulated'
export type OrderStatus = 'pending_payment' | 'paid' | 'partially_refunded' | 'refunded' | 'voided'
export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict'
export type RefundStatus = 'pending' | 'processing' | 'needs_attention' | 'processed' | 'failed'

export interface TaxComponent {
  id: string
  code: string
  name: string
  ratePercent: number
  method: 'same_base' | 'compound'
  order: number
}

export interface TaxCategory {
  id: string
  storeId: string
  code: string
  name: string
  treatment: TaxTreatment
  defaultPriceMode: PriceMode
  components: TaxComponent[]
  effectiveFrom: string
  active: boolean
}

export interface Product {
  id: string
  storeId: string
  name: string
  sku: string
  categoryId: string
  categoryName: string
  taxCategoryId: string
  priceMinor: number
  currencyCode: string
  priceMode: PriceMode
  taxRateOverride?: number | null
  unitName: string
  active: boolean
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export interface TaxLine {
  code: string
  name: string
  ratePercent: number
  baseMinor: number
  taxMinor: number
}

export interface CalculatedLine {
  productId: string
  name: string
  sku: string
  quantity: number
  unitPriceMinor: number
  priceMode: PriceMode
  categoryId: string
  categoryName: string
  taxCategoryId: string
  taxCategoryName: string
  taxableBaseMinor: number
  taxRatePercent: number
  taxMinor: number
  grossMinor: number
  taxBreakdown: TaxLine[]
}

export interface Order {
  id: string
  clientOrderId: string
  storeId: string
  deviceId: string
  employeeId: string
  employeeName: string
  shiftId?: string
  orderNumber: string
  status: OrderStatus
  currencyCode: string
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  items: CalculatedLine[]
  paymentMethod?: PaymentMethod
  paymentStatus?: PaymentStatus
  providerReference?: string
  providerTransactionId?: string
  cashTenderedMinor?: number
  changeMinor?: number
  refundedMinor: number
  createdAt: string
  updatedAt: string
  localCreatedAt: string
  syncStatus: SyncStatus
  receiptEmail?: string
  source: 'local' | 'cloud' | 'demo'
}

export interface Payment {
  id: string
  orderId: string
  storeId: string
  deviceId: string
  method: PaymentMethod
  status: PaymentStatus
  amountMinor: number
  currencyCode: string
  provider?: 'paystack' | 'flutterwave' | 'cash' | 'demo'
  providerNetwork?: string
  providerReference?: string
  providerTransactionId?: string
  idempotencyKey: string
  createdAt: string
  confirmedAt?: string
}

export interface RefundLine {
  orderLineId: string
  productId: string
  productName: string
  quantity: number
  restock: boolean
  itemMinor: number
  taxMinor: number
}

export interface Refund {
  id: string
  storeId: string
  orderId: string
  paymentId?: string
  orderNumber: string
  amountMinor: number
  taxMinor: number
  method: PaymentMethod
  status: RefundStatus
  reason: string
  lines: RefundLine[]
  createdAt: string
  providerRefundId?: string
  syncStatus: SyncStatus
}

export interface InventoryItem {
  storeId: string
  productId: string
  quantityOnHand: number
  rowVersion: number
  updatedAt: string
}

export interface InventoryMovement {
  id: string
  storeId: string
  productId: string
  deviceId: string
  employeeId: string
  movementType: 'sale' | 'return' | 'receive' | 'count_adjustment' | 'damage' | 'opening_balance'
  quantityDelta: number
  baseVersion?: number
  orderId?: string
  refundId?: string
  reason?: string
  createdAt: string
  syncStatus: SyncStatus
}

export interface Employee {
  id: string
  storeId: string
  authUserId?: string
  displayName: string
  role: UserRole
  refundLimitMinor?: number | null
  status: 'active' | 'disabled'
  createdAt: string
}

export interface Shift {
  id: string
  storeId: string
  deviceId: string
  employeeId: string
  employeeName: string
  status: 'open' | 'closed'
  openingFloatMinor: number
  expectedCashMinor: number
  countedCashMinor?: number
  varianceMinor?: number
  varianceReason?: string
  openedAt: string
  closedAt?: string
  syncStatus: SyncStatus
}

export type SyncEventType = 'order' | 'refund' | 'inventory_movement' | 'shift' | 'product' | 'tax' | 'employee'

export interface SyncEvent {
  eventId: string
  storeId: string
  deviceId: string
  employeeId: string
  eventType: SyncEventType
  entityId: string
  payload: unknown
  createdAt: string
  status: 'pending' | 'synced' | 'conflict'
  lastError?: string
}

export interface DemoSettings {
  demoMode: boolean
  currencyCode: 'GHS' | 'KES' | 'USD' | 'EUR'
  taxProfileStatus: 'demo' | 'unverified' | 'verified'
}
