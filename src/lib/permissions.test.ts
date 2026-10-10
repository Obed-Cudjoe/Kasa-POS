import { describe, expect, it } from 'vitest'
import { isWithinRefundLimit } from './permissions'

describe('per-transaction refund authorization', () => {
  it('allows an amount at or below a configured limit, and denies an amount above it', () => {
    expect(isWithinRefundLimit(1_000, 1_000)).toBe(true)
    expect(isWithinRefundLimit(999, 1_000)).toBe(true)
    expect(isWithinRefundLimit(1_001, 1_000)).toBe(false)
  })

  it('treats zero as no refund authority and null as an explicit no-cap owner setting', () => {
    expect(isWithinRefundLimit(1, 0)).toBe(false)
    expect(isWithinRefundLimit(1, null)).toBe(true)
    expect(isWithinRefundLimit(1, undefined)).toBe(false)
  })

  it('rejects invalid amounts and invalid limits', () => {
    expect(isWithinRefundLimit(0, null)).toBe(false)
    expect(isWithinRefundLimit(-1, null)).toBe(false)
    expect(isWithinRefundLimit(1.5, 10)).toBe(false)
    expect(isWithinRefundLimit(1, -1)).toBe(false)
    expect(isWithinRefundLimit(1, Number.NaN)).toBe(false)
  })
})
