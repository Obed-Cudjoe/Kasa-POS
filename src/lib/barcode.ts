import type { Product } from './types'

/** Preserve the raw text (including leading zeroes) for storage and exact scans. */
export function normalizeBarcode(value: string) {
  return value.trim().toLowerCase()
}

export function isValidBarcode(value: string) {
  const barcode = value.trim()
  return !barcode || /^[A-Za-z0-9._/-]{1,64}$/.test(barcode)
}

/** Most USB/Bluetooth retail scanners emulate a keyboard and send the code as text. */
export function findProductByScanCode(products: Product[], value: string) {
  const code = normalizeBarcode(value)
  if (!code) return undefined
  return products.find((product) => product.active && (
    normalizeBarcode(product.barcode ?? '') === code || normalizeBarcode(product.sku) === code
  ))
}
