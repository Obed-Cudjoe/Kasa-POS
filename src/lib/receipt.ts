import type { Order, Refund } from './types'
import { formatMoney } from './money'

const asciiSafe = (value: string) => value
  .replace(/[–—]/g, '-')
  .replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/·/g, '|')
  .replace(/₵/g, 'GHS ')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

export async function createReceiptPdf(order: Order, refund?: Refund, shopName = 'Kasa POS') {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const width = 226
  const lineHeight = 14
  const itemRows = order.items.length * 3
  const taxRows = new Set(order.items.flatMap((item) => item.taxBreakdown.map((tax) => tax.code))).size
  const height = Math.max(420, 220 + itemRows * lineHeight + taxRows * lineHeight + (refund ? 90 : 0))
  const page = pdf.addPage([width, height])
  const left = 18
  const right = width - 18
  let y = height - 25
  const draw = (text: string, opts: { strong?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: ReturnType<typeof rgb> } = {}) => {
    const size = opts.size ?? 9
    const font = opts.strong ? bold : regular
    const value = asciiSafe(text)
    const measured = font.widthOfTextAtSize(value, size)
    const x = opts.align === 'right' ? right - measured : opts.align === 'center' ? (width - measured) / 2 : left
    page.drawText(value, { x, y, size, font, color: opts.color ?? rgb(0.12, 0.16, 0.14), maxWidth: right - left })
    y -= lineHeight
  }
  const rule = () => {
    y -= 2
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.78, 0.81, 0.79) })
    y -= 9
  }

  draw(shopName.trim().slice(0, 80) || 'Kasa POS', { strong: true, size: 17, align: 'center' })
  draw(refund ? 'RETAIL RETURN RECEIPT' : 'RETAIL SALES RECEIPT', { size: 7, align: 'center' })
  rule()
  draw(`Receipt ${order.orderNumber}`, { strong: true })
  draw(new Date(order.createdAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' }), { size: 8 })
  draw(`Served by ${order.employeeName}`, { size: 8 })
  draw(`Payment: ${(order.paymentMethod ?? 'pending').toUpperCase()} · ${String(order.paymentStatus ?? '').replaceAll('_', ' ')}`, { size: 8 })
  rule()
  for (const item of order.items) {
    draw(`${item.quantity} × ${item.name}`, { strong: true, size: 8 })
    draw(`${formatMoney(item.grossMinor, order.currencyCode)}  ·  tax ${formatMoney(item.taxMinor, order.currencyCode)} (${item.taxRatePercent.toFixed(2)}%)`, { size: 7 })
    for (const tax of item.taxBreakdown) {
      draw(`  ${tax.name} ${tax.ratePercent.toFixed(2)}%`, { size: 7 })
    }
  }
  rule()
  draw(`Net subtotal  ${formatMoney(order.subtotalMinor, order.currencyCode)}`, { size: 8 })
  draw(`Tax total     ${formatMoney(order.taxMinor, order.currencyCode)}`, { size: 8 })
  draw(`TOTAL         ${formatMoney(order.totalMinor, order.currencyCode)}`, { strong: true, size: 12 })
  if (order.paymentMethod === 'cash' && order.cashTenderedMinor !== undefined) {
    draw(`Cash received ${formatMoney(order.cashTenderedMinor, order.currencyCode)}`, { size: 8 })
    draw(`Change        ${formatMoney(order.changeMinor ?? 0, order.currencyCode)}`, { size: 8 })
  }
  if (order.refundedMinor > 0) draw(`Refunded to date ${formatMoney(order.refundedMinor, order.currencyCode)}`, { size: 8 })
  if (refund) {
    rule()
    draw(`RETURN ${refund.id.slice(0, 8)}`, { strong: true })
    draw(`${refund.status.toUpperCase()} · ${refund.reason}`, { size: 8 })
    draw(`Refund amount ${formatMoney(refund.amountMinor, order.currencyCode)}`, { strong: true })
    draw(`Tax reversed ${formatMoney(refund.taxMinor, order.currencyCode)}`, { size: 8 })
    for (const item of refund.lines) draw(`${item.quantity} × ${item.productName} · ${item.restock ? 'restocked' : 'not restocked'}`, { size: 7 })
  }
  rule()
  draw('Thank you for shopping with us.', { align: 'center', size: 8 })
  if (order.paymentStatus === 'demo_simulated') draw('DEMO PAYMENT SIMULATION · NO FUNDS MOVED', { align: 'center', size: 6 })
  draw('Confirm local receipt and tax requirements before live use.', { align: 'center', size: 6 })
  return pdf.save()
}

export async function downloadReceiptPdf(order: Order, refund?: Refund, shopName = 'Kasa POS') {
  const bytes = await createReceiptPdf(order, refund, shopName)
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${order.orderNumber}${refund ? '-refund' : ''}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

export async function shareReceipt(order: Order, refund?: Refund, shopName = 'Kasa POS') {
  const pdfBytes = await createReceiptPdf(order, refund, shopName)
  const file = new File([pdfBytes as BlobPart], `${order.orderNumber}${refund ? '-refund' : ''}.pdf`, { type: 'application/pdf' })
  const businessName = shopName.trim() || 'Kasa POS'
  const summary = refund
    ? `${businessName} refund ${formatMoney(refund.amountMinor, order.currencyCode)} for receipt ${order.orderNumber} (${refund.status}).`
    : `${businessName} receipt ${order.orderNumber}. Total: ${formatMoney(order.totalMinor, order.currencyCode)}. Tax: ${formatMoney(order.taxMinor, order.currencyCode)}.`
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title: `${businessName} receipt`, text: summary, files: [file] })
    return 'shared' as const
  }
  await downloadReceiptPdf(order, refund, shopName)
  return 'downloaded' as const
}

export async function printReceiptEscPos(order: Order, transport: 'bluetooth' | 'usb' = 'bluetooth', shopName = 'Kasa POS') {
  if (!window.isSecureContext) throw new Error('Printer access requires HTTPS or localhost.')
  if (transport === 'bluetooth' && !('bluetooth' in navigator)) throw new Error('Web Bluetooth is not available in this browser. Use Chrome/Edge on Android or print the PDF.')
  if (transport === 'usb' && !('usb' in navigator)) throw new Error('WebUSB is not available in this browser. Use a supported desktop Chromium browser or print the PDF.')

  const [{ default: Encoder }, printerModule] = await Promise.all([
    import('@point-of-sale/receipt-printer-encoder'),
    transport === 'bluetooth'
      // @ts-expect-error These small browser transports publish a browser condition but no root Node export/types.
      ? import('../../node_modules/@point-of-sale/webbluetooth-receipt-printer/dist/webbluetooth-receipt-printer.esm.js')
      // @ts-expect-error These small browser transports publish a browser condition but no root Node export/types.
      : import('../../node_modules/@point-of-sale/webusb-receipt-printer/dist/webusb-receipt-printer.esm.js'),
  ])
  const Printer = printerModule.default as new () => {
    addEventListener: (event: string, callback: (device: { language?: string; columns?: number; codepageMapping?: unknown; name?: string }) => void) => void
    connect: () => Promise<void> | void
    print: (data: Uint8Array) => Promise<void>
  }
  const printer = new Printer()
  const device = await new Promise<{ language?: string; columns?: number; codepageMapping?: unknown; name?: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Printer connection timed out or was cancelled.')), 35_000)
    printer.addEventListener('connected', (connectedDevice) => {
      window.clearTimeout(timer)
      resolve(connectedDevice)
    })
    try {
      const promise = printer.connect()
      if (promise && typeof (promise as Promise<void>).catch === 'function') (promise as Promise<void>).catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
    } catch (error) {
      window.clearTimeout(timer)
      reject(error)
    }
  })
  const encoder = new Encoder({
    language: (device.language as 'esc-pos' | 'star-line' | 'star-prnt' | undefined) ?? 'esc-pos',
    columns: device.columns ?? 42,
    codepageMapping: device.codepageMapping && typeof device.codepageMapping === 'object' ? device.codepageMapping as Record<string, number> : undefined,
    errors: 'relaxed',
  })
  encoder.initialize().align('center').bold(true).line(shopName.trim().slice(0, 80) || 'Kasa POS').bold(false)
    .line('RETAIL SALES RECEIPT').newline().align('left')
    .line(`Receipt ${order.orderNumber}`)
    .line(new Date(order.createdAt).toLocaleString('en-GH'))
    .line(`Cashier: ${order.employeeName}`).rule()
  for (const item of order.items) {
    encoder.line(`${item.quantity} x ${item.name}`)
      .line(`  ${formatMoney(item.grossMinor, order.currencyCode)}  tax ${formatMoney(item.taxMinor, order.currencyCode)}`)
    for (const tax of item.taxBreakdown) encoder.line(`    ${tax.code} ${tax.ratePercent.toFixed(2)}% ${formatMoney(tax.taxMinor, order.currencyCode)}`)
  }
  encoder.rule().line(`Net: ${formatMoney(order.subtotalMinor, order.currencyCode)}`)
    .line(`Tax: ${formatMoney(order.taxMinor, order.currencyCode)}`)
    .bold(true).line(`TOTAL: ${formatMoney(order.totalMinor, order.currencyCode)}`).bold(false)
  if (order.paymentMethod === 'cash' && order.cashTenderedMinor !== undefined) {
    encoder.line(`Tendered: ${formatMoney(order.cashTenderedMinor, order.currencyCode)}`)
      .line(`Change: ${formatMoney(order.changeMinor ?? 0, order.currencyCode)}`)
  }
  encoder.newline().align('center').line('Thank you!')
    .newline(3).cut()
  await printer.print(encoder.encode())
  return device.name ?? 'receipt printer'
}

