import { describe, expect, it } from 'vitest'
import { calculateLine, summarizeLines } from './tax'
import type { Product, TaxCategory } from './types'

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1', storeId: 'store-1', name: 'Sample product', sku: 'SKU-1',
  categoryId: 'category-1', categoryName: 'General', taxCategoryId: 'tax-1',
  priceMinor: 12_000, currencyCode: 'GHS', priceMode: 'inclusive',
  unitName: 'each', active: true, rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const taxProfile = (overrides: Partial<TaxCategory> = {}): TaxCategory => ({
  id: 'tax-1', storeId: 'store-1', code: 'DEMO', name: 'Demo composite tax',
  treatment: 'standard_rated', defaultPriceMode: 'inclusive', effectiveFrom: '2026-01-01', active: true,
  components: [
    { id: 'vat', code: 'VAT', name: 'VAT', ratePercent: 15, method: 'same_base', order: 1 },
    { id: 'nhil', code: 'NHIL', name: 'NHIL', ratePercent: 2.5, method: 'same_base', order: 2 },
    { id: 'getfund', code: 'GETFUND', name: 'GETFund', ratePercent: 2.5, method: 'same_base', order: 3 },
  ],
  ...overrides,
})

describe('transaction-time tax calculation', () => {
  it('extracts same-base composite tax from an inclusive price', () => {
    const line = calculateLine(product(), 1, taxProfile())
    expect(line.taxableBaseMinor).toBe(10_000)
    expect(line.taxMinor).toBe(2_000)
    expect(line.grossMinor).toBe(12_000)
    expect(line.taxBreakdown.map((tax) => tax.taxMinor)).toEqual([1_500, 250, 250])
  })

  it('adds tax to an exclusive price and reports a gross total', () => {
    const line = calculateLine(product({ priceMinor: 10_000, priceMode: 'exclusive' }), 1, taxProfile())
    expect(line.taxableBaseMinor).toBe(10_000)
    expect(line.taxMinor).toBe(2_000)
    expect(line.grossMinor).toBe(12_000)
  })

  it('reverses and reapplies a compound stack for inclusive prices', () => {
    const profile = taxProfile({ components: [
      { id: 'a', code: 'A', name: 'A 10%', ratePercent: 10, method: 'same_base', order: 1 },
      { id: 'b', code: 'B', name: 'B 10% compound', ratePercent: 10, method: 'compound', order: 2 },
    ] })
    const line = calculateLine(product({ priceMinor: 12_100 }), 1, profile)
    expect(line.taxableBaseMinor).toBe(10_000)
    expect(line.taxBreakdown.map((tax) => tax.taxMinor)).toEqual([1_000, 1_100])
    expect(line.grossMinor).toBe(12_100)
  })

  it.each(['zero_rated', 'exempt', 'out_of_scope'] as const)('does not charge components for %s treatment', (treatment) => {
    const line = calculateLine(product(), 1, taxProfile({ treatment }))
    expect(line.taxMinor).toBe(0)
    expect(line.grossMinor).toBe(12_000)
    expect(line.taxBreakdown).toEqual([])
  })

  it('uses a product-level single-rate override instead of category components', () => {
    const line = calculateLine(product({ priceMinor: 10_000, priceMode: 'exclusive', taxRateOverride: 5 }), 2, taxProfile())
    expect(line.taxMinor).toBe(1_000)
    expect(line.grossMinor).toBe(21_000)
    expect(line.taxBreakdown).toHaveLength(1)
  })

  it('scales a line by quantity and reconciles the cart totals', () => {
    const one = calculateLine(product({ priceMinor: 1_200 }), 2, taxProfile())
    const two = calculateLine(product({ id: 'product-2', priceMinor: 600, taxCategoryId: 'zero' }), 3, taxProfile({ id: 'zero', treatment: 'zero_rated', components: [] }))
    expect(one.grossMinor).toBe(2_400)
    expect(two.taxMinor).toBe(0)
    expect(summarizeLines([one, two])).toEqual({ subtotalMinor: 3_800, taxMinor: 400, totalMinor: 4_200 })
  })
})
