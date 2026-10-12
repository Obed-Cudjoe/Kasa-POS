import { describe, expect, it } from 'vitest'
import { findProductByScanCode, isValidBarcode, normalizeBarcode } from './barcode'
import { DEMO_PRODUCTS } from './demo-seed'

describe('keyboard-wedge barcode lookup', () => {
  it('preserves leading zeroes while normalizing letter case for comparison', () => {
    expect(normalizeBarcode('  0000123456789  ')).toBe('0000123456789')
    expect(normalizeBarcode(' AbC-01 ')).toBe('abc-01')
  })

  it('finds an active product by barcode or SKU and ignores inactive products', () => {
    const product = { ...DEMO_PRODUCTS[0]!, barcode: '0000123456789' }
    const alphaProduct = { ...DEMO_PRODUCTS[1]!, barcode: 'AbC-01' }
    const inactive = { ...DEMO_PRODUCTS[2]!, barcode: 'TEST-001', active: false }
    expect(findProductByScanCode([product, inactive], '0000123456789')?.id).toBe(product.id)
    expect(findProductByScanCode([product], product.sku)?.id).toBe(product.id)
    expect(findProductByScanCode([alphaProduct], 'abc-01')?.id).toBe(alphaProduct.id)
    expect(findProductByScanCode([inactive], 'TEST-001')).toBeUndefined()
  })

  it('accepts blank optional values and limits codes to portable-reader-friendly characters', () => {
    expect(isValidBarcode('')).toBe(true)
    expect(isValidBarcode('0123456789012')).toBe(true)
    expect(isValidBarcode('SKU-AB_01')).toBe(true)
    expect(isValidBarcode('123 456')).toBe(false)
    expect(isValidBarcode('x'.repeat(65))).toBe(false)
  })
})
