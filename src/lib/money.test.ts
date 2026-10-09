import { describe, expect, it } from 'vitest'
import { formatMoney, inputFromMinor, parseMoneyInput } from './money'

describe('minor-unit money helpers', () => {
  it('parses currency labels and decimals into minor units', () => {
    expect(parseMoneyInput('GHS 1,234.56')).toBe(123_456)
    expect(parseMoneyInput('7')).toBe(700)
    expect(parseMoneyInput('not a number')).toBe(0)
  })

  it('formats inputs for editable cash fields', () => {
    expect(inputFromMinor(25)).toBe('0.25')
    expect(inputFromMinor(12_340)).toBe('123.40')
  })

  it('formats with an explicit currency code', () => {
    expect(formatMoney(1_234, 'GHS')).toBe('GHS 12.34')
    expect(formatMoney(2_500, 'USD')).toBe('USD 25.00')
  })
})
