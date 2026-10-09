export function formatMoney(minor: number, currency = 'GHS', locale = currency === 'GHS' ? 'en-GH' : 'en') {
  const amount = minor / 100
  try {
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    return `${currency} ${formatted}`
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatCompactMoney(minor: number, currency = 'GHS') {
  return `${currency} ${(minor / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function parseMoneyInput(value: string): number {
  const cleaned = value.replace(/[^\d.]/g, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export function inputFromMinor(minor: number) {
  return (minor / 100).toFixed(2)
}
