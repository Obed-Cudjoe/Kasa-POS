export function isWithinRefundLimit(amountMinor: number, limitMinor: number | null | undefined) {
  const effectiveLimit = limitMinor === undefined ? 0 : limitMinor
  return Number.isSafeInteger(amountMinor)
    && amountMinor > 0
    && (effectiveLimit === null || (Number.isSafeInteger(effectiveLimit) && effectiveLimit >= 0 && amountMinor <= effectiveLimit))
}
