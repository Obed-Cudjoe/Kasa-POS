import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Resend } from 'resend'
import { authorizeRequest, routeError } from '@/lib/cloud'
import { formatMoney } from '@/lib/money'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacy'

export const dynamic = 'force-dynamic'

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const cleanPdf = (value: string) => value.replace(/[–—]/g, '-').replace(/·/g, '|').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

async function buildPdf(order: Record<string, unknown>, items: Array<Record<string, unknown>>, taxes: Array<Record<string, unknown>>) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const width = 226
  const height = Math.max(440, 260 + items.length * 40 + taxes.length * 14)
  const page = pdf.addPage([width, height])
  const left = 18
  const right = width - 18
  let y = height - 28
  const line = (text: string, strong = false, size = 9, align: 'left' | 'right' | 'center' = 'left') => {
    const value = cleanPdf(text)
    const font = strong ? bold : regular
    const textWidth = font.widthOfTextAtSize(value, size)
    const x = align === 'right' ? right - textWidth : align === 'center' ? (width - textWidth) / 2 : left
    page.drawText(value, { x, y, size, font, color: rgb(0.12, 0.16, 0.14), maxWidth: right - left })
    y -= 14
  }
  const rule = () => { y -= 2; page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.78, 0.81, 0.79) }); y -= 9 }
  const currency = String(order.currency_code ?? 'GHS')
  line('KASA POS', true, 17, 'center')
  line('RETAIL RECEIPT', false, 8, 'center')
  rule()
  line(`Receipt ${String(order.order_number ?? order.id)}`, true)
  line(new Date(String(order.created_at)).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' }), false, 8)
  line(`Payment: ${String(order.status ?? '').replaceAll('_', ' ')}`, false, 8)
  rule()
  for (const item of items) {
    line(`${String(item.quantity)} x ${String(item.product_name_snapshot)}`, true, 8)
    line(`${formatMoney(Number(item.line_total), currency)}  ·  tax ${formatMoney(Number(item.tax_amount), currency)} (${Number(item.tax_rate).toFixed(2)}%)`, false, 7)
  }
  rule()
  line(`Net subtotal  ${formatMoney(Number(order.subtotal_amount), currency)}`, false, 8)
  line(`Tax total     ${formatMoney(Number(order.tax_amount), currency)}`, false, 8)
  line(`TOTAL         ${formatMoney(Number(order.total_amount), currency)}`, true, 12)
  if (taxes.length) {
    rule()
    line('Tax breakdown', true, 8)
    for (const tax of taxes) line(`${String(tax.component_name_snapshot)} ${Number(tax.rate_percent).toFixed(2)}%   ${formatMoney(Number(tax.tax_amount), currency)}`, false, 7)
  }
  rule()
  line('Thank you for shopping with us.', false, 8, 'center')
  line('Receipt is not a substitute for local E-VAT/CIS certification.', false, 6, 'center')
  return pdf.save()
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeRequest(request)
    if (!process.env.RESEND_API_KEY || !process.env.RECEIPT_FROM_EMAIL) {
      return Response.json({ error: 'Managed receipt email is not configured. Use the device Share/Mail or PDF print fallback.' }, { status: 503 })
    }
    const body = await request.json() as { orderId?: string; email?: string }
    const recipient = body.email?.trim()
    if (!body.orderId || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return Response.json({ error: 'Enter a valid email address and receipt ID.' }, { status: 400 })
    }
    const { data: order, error: orderError } = await actor.admin.from('orders')
      .select('id,store_id,employee_id,order_number,status,currency_code,subtotal_amount,tax_amount,total_amount,created_at')
      .eq('store_id', actor.storeId).eq('id', body.orderId).maybeSingle()
    if (orderError || !order) return Response.json({ error: 'Receipt was not found in the signed-in store.' }, { status: 404 })
    if (actor.role === 'cashier' && order.employee_id !== actor.employeeId) {
      return Response.json({ error: 'Cashiers may email receipts only for their own sales.' }, { status: 403 })
    }
    const { data: consent, error: consentError } = await actor.admin.from('privacy_consent_events').select('id')
      .eq('store_id', actor.storeId).eq('order_id', order.id)
      .eq('purpose_code', 'receipt_email').eq('policy_version', PRIVACY_NOTICE_VERSION).maybeSingle()
    if (consentError || !consent) return Response.json({ error: 'Customer consent for receipt email must be recorded before sending.' }, { status: 403 })
    const { data: items, error: itemError } = await actor.admin.from('order_items')
      .select('id,product_name_snapshot,quantity,currency_code,line_total,tax_rate,tax_amount')
      .eq('store_id', actor.storeId).eq('order_id', order.id).order('created_at')
    if (itemError) throw new Error(itemError.message)
    const itemIds = (items ?? []).map((item) => item.id)
    const { data: taxes, error: taxError } = itemIds.length
      ? await actor.admin.from('order_item_taxes').select('component_name_snapshot,rate_percent,tax_amount').eq('store_id', actor.storeId).in('order_item_id', itemIds)
      : { data: [], error: null }
    if (taxError) throw new Error(taxError.message)
    const pdf = await buildPdf(order, items ?? [], taxes ?? [])
    const resend = new Resend(process.env.RESEND_API_KEY)
    const total = formatMoney(Number(order.total_amount), order.currency_code)
    const { data: sent, error: sendError } = await resend.emails.send({
      from: process.env.RECEIPT_FROM_EMAIL,
      to: recipient,
      subject: `Receipt ${order.order_number} · Kasa POS`,
      html: `<p>Thank you for shopping with us.</p><p>Receipt <strong>${esc(order.order_number ?? '')}</strong> · ${esc(total)}</p><p>The PDF includes the item and tax breakdown.</p><p><small>Confirm applicable local receipt and tax certification requirements before use.</small></p>`,
      attachments: [{ filename: `${order.order_number || 'receipt'}.pdf`, content: Buffer.from(pdf).toString('base64') }],
    })
    if (sendError) throw new Error(sendError.message)
    return Response.json({ ok: true, emailId: sent?.id }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
