import type { CalculatedLine, Product, TaxCategory, TaxComponent } from './types'

const BASIS_POINTS = 10_000
const toBps = (ratePercent: number) => Math.round(ratePercent * 100)

function allocateSameBaseTax(baseMinor: number, components: TaxComponent[]) {
  const lines = components.map((component) => ({
    code: component.code,
    name: component.name,
    ratePercent: component.ratePercent,
    baseMinor,
    taxMinor: Math.round((baseMinor * toBps(component.ratePercent)) / BASIS_POINTS),
  }))
  return lines
}

function calculateExclusive(baseMinor: number, components: TaxComponent[]) {
  const sorted = [...components].sort((a, b) => a.order - b.order)
  let runningBase = baseMinor
  const lines = sorted.map((component) => {
    const componentBase = component.method === 'compound' ? runningBase : baseMinor
    const taxMinor = Math.round((componentBase * toBps(component.ratePercent)) / BASIS_POINTS)
    if (component.method === 'compound') runningBase += taxMinor
    return {
      code: component.code,
      name: component.name,
      ratePercent: component.ratePercent,
      baseMinor: componentBase,
      taxMinor,
    }
  })
  return lines
}

function calculateInclusive(grossMinor: number, components: TaxComponent[]) {
  const sorted = [...components].sort((a, b) => a.order - b.order)
  if (sorted.every((component) => component.method === 'same_base')) {
    const totalBps = sorted.reduce((sum, component) => sum + toBps(component.ratePercent), 0)
    const baseMinor = Math.round((grossMinor * BASIS_POINTS) / (BASIS_POINTS + totalBps))
    const lines = allocateSameBaseTax(baseMinor, sorted)
    const expectedTax = grossMinor - baseMinor
    const allocated = lines.reduce((sum, line) => sum + line.taxMinor, 0)
    if (lines.length && allocated !== expectedTax) lines[lines.length - 1].taxMinor += expectedTax - allocated
    return { baseMinor, lines }
  }

  // Reverse a compound stack from the outside in, then calculate its exact components forward.
  let baseMinor = grossMinor
  for (const component of [...sorted].reverse()) {
    baseMinor = Math.round((baseMinor * BASIS_POINTS) / (BASIS_POINTS + toBps(component.ratePercent)))
  }
  const lines = calculateExclusive(baseMinor, sorted)
  const totalTax = lines.reduce((sum, line) => sum + line.taxMinor, 0)
  if (lines.length) lines[lines.length - 1].taxMinor += grossMinor - baseMinor - totalTax
  return { baseMinor, lines }
}

export function calculateLine(product: Product, quantity: number, taxCategory: TaxCategory): CalculatedLine {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be a positive finite number.')
  if (!Number.isSafeInteger(product.priceMinor) || product.priceMinor < 0) throw new Error('Unit price must be a non-negative safe integer in minor units.')
  const extendedMinor = product.priceMinor * quantity
  if (!Number.isFinite(extendedMinor) || !Number.isSafeInteger(Math.round(extendedMinor))) throw new Error('Extended price exceeds the safe minor-unit range.')
  const enteredMinor = Math.round(extendedMinor)
  let components = taxCategory.treatment === 'standard_rated' ? taxCategory.components : []
  if (taxCategory.treatment === 'standard_rated' && product.taxRateOverride !== null && product.taxRateOverride !== undefined) {
    if (!Number.isFinite(product.taxRateOverride) || product.taxRateOverride < 0 || product.taxRateOverride > 100) {
      throw new Error('Product tax override must be between 0 and 100 percent.')
    }
    components = [{ id: `override-${product.id}`, code: 'PRODUCT', name: 'Product tax', ratePercent: product.taxRateOverride, method: 'same_base', order: 1 }]
  }
  if (components.some((component) => !Number.isFinite(component.ratePercent) || component.ratePercent < 0 || component.ratePercent > 100)) {
    throw new Error('Tax component rates must be between 0 and 100 percent.')
  }

  const taxCalculation = product.priceMode === 'inclusive'
    ? calculateInclusive(enteredMinor, components)
    : { baseMinor: enteredMinor, lines: calculateExclusive(enteredMinor, components) }
  const taxMinor = taxCalculation.lines.reduce((sum, line) => sum + line.taxMinor, 0)
  const grossMinor = product.priceMode === 'inclusive' ? enteredMinor : enteredMinor + taxMinor
  const totalRate = components.reduce((sum, component) => sum + component.ratePercent, 0)

  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity,
    unitPriceMinor: product.priceMinor,
    priceMode: product.priceMode,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    taxCategoryId: product.taxCategoryId,
    taxCategoryName: taxCategory.name,
    taxableBaseMinor: taxCalculation.baseMinor,
    taxRatePercent: totalRate,
    taxMinor,
    grossMinor,
    taxBreakdown: taxCalculation.lines,
  }
}

export function summarizeLines(lines: CalculatedLine[]) {
  return lines.reduce((summary, line) => ({
    subtotalMinor: summary.subtotalMinor + line.taxableBaseMinor,
    taxMinor: summary.taxMinor + line.taxMinor,
    totalMinor: summary.totalMinor + line.grossMinor,
  }), { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 })
}

export function taxLabel(treatment: TaxCategory['treatment']) {
  switch (treatment) {
    case 'standard_rated': return 'Standard rated'
    case 'zero_rated': return 'Zero-rated'
    case 'exempt': return 'Exempt'
    default: return 'Out of scope'
  }
}
