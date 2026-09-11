import PDFDocument from 'pdfkit'

import { formatMinor } from '../common/money.js'
import type { Customer } from '../customers/customer.entity.js'
import type { DunningNotice } from '../dunning/dunning-notice.entity.js'
import type { Invoice } from '../invoices/invoice.entity.js'
import type { Tenant } from '../tenants/tenant.entity.js'

type Doc = InstanceType<typeof PDFDocument>

function collect(title: string, draw: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: title, Producer: 'Dunlin' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    draw(doc)
    doc.end()
  })
}

function addressBlock(doc: Doc, customer: Customer): void {
  doc.text(customer.name)
  const address = customer.address
  if (address) {
    doc.text(address.line1)
    if (address.line2) doc.text(address.line2)
    doc.text(`${address.postalCode} ${address.city}`)
    doc.text(address.country)
  }
  if (customer.vatId) doc.text(`VAT ${customer.vatId}`)
}

function letterhead(
  doc: Doc,
  tenant: Tenant,
  customer: Customer,
  title: string,
  meta: Array<[string, string]>,
): void {
  doc.fontSize(18).text(tenant.name)
  doc
    .moveDown(0.5)
    .fontSize(10)
    .fillColor('#555')
    .text(`${tenant.country} · ${tenant.currency}`)
    .fillColor('#000')
  doc.moveDown(2)
  addressBlock(doc, customer)
  doc.moveDown(2)
  doc.fontSize(16).text(title)
  doc.moveDown(0.5).fontSize(10)
  for (const [label, value] of meta) doc.text(`${label}: ${value}`)
  doc.moveDown(1.5)
}

const COLUMNS = { description: 50, quantity: 300, unit: 360, tax: 430, total: 480 } as const

function lineTable(doc: Doc, invoice: Invoice): void {
  const { currency } = invoice
  const y = doc.y
  doc.fontSize(9).fillColor('#555')
  doc.text('Description', COLUMNS.description, y)
  doc.text('Qty', COLUMNS.quantity, y, { width: 50, align: 'right' })
  doc.text('Unit', COLUMNS.unit, y, { width: 60, align: 'right' })
  doc.text('Tax', COLUMNS.tax, y, { width: 40, align: 'right' })
  doc.text('Total', COLUMNS.total, y, { width: 65, align: 'right' })
  doc.fillColor('#000').moveDown(0.8)

  for (const line of [...invoice.lines].sort((a, b) => a.position - b.position)) {
    const rowY = doc.y
    doc.fontSize(10).text(line.description, COLUMNS.description, rowY, { width: 240 })
    const rowBottom = doc.y
    doc.text(String(line.quantity), COLUMNS.quantity, rowY, { width: 50, align: 'right' })
    doc.text(formatMinor(line.unitPriceMinor, currency), COLUMNS.unit, rowY, {
      width: 60,
      align: 'right',
    })
    doc.text(`${(line.taxRateBps / 100).toFixed(1)} %`, COLUMNS.tax, rowY, {
      width: 40,
      align: 'right',
    })
    doc.text(formatMinor(line.totalMinor, currency), COLUMNS.total, rowY, {
      width: 65,
      align: 'right',
    })
    doc.y = rowBottom + 4
  }

  doc.moveDown(1)
  const totals: Array<[string, number]> = [
    ['Subtotal', invoice.subtotalMinor],
    ['Tax', invoice.taxMinor],
    ['Total', invoice.totalMinor],
  ]
  for (const [label, amount] of totals) {
    const rowY = doc.y
    doc
      .fontSize(label === 'Total' ? 11 : 10)
      .text(label, COLUMNS.unit, rowY, { width: 100, align: 'right' })
    doc.text(formatMinor(amount, currency), COLUMNS.total, rowY, { width: 65, align: 'right' })
    doc.moveDown(0.3)
  }
  doc.x = COLUMNS.description
}

export function renderInvoicePdf(
  tenant: Tenant,
  customer: Customer,
  invoice: Invoice,
): Promise<Buffer> {
  return collect(`Invoice ${invoice.number}`, (doc) => {
    letterhead(doc, tenant, customer, `Invoice ${invoice.number}`, [
      ['Issued', invoice.issuedOn ?? '—'],
      ['Due', invoice.dueOn ?? '—'],
    ])
    lineTable(doc, invoice)
    doc.moveDown(2)
    if (invoice.notes) doc.fontSize(10).text(invoice.notes)
    doc
      .moveDown(1)
      .fontSize(9)
      .fillColor('#555')
      .text(`Please quote ${invoice.number} with your payment.`)
  })
}

export function renderDunningNoticePdf(
  tenant: Tenant,
  customer: Customer,
  invoice: Invoice,
  notice: DunningNotice,
): Promise<Buffer> {
  const titles: Record<DunningNotice['template'], string> = {
    reminder: 'Payment reminder',
    second_reminder: 'Second payment reminder',
    final_notice: 'Final notice',
  }
  const { currency } = invoice
  return collect(`${titles[notice.template]} ${invoice.number}`, (doc) => {
    letterhead(doc, tenant, customer, titles[notice.template], [
      ['Invoice', invoice.number ?? '—'],
      ['Was due', invoice.dueOn ?? '—'],
      ['Notice date', notice.issuedOn],
      ['Please pay by', notice.respondBy],
    ])
    doc.fontSize(10)
    doc.text(
      `Invoice ${invoice.number} is ${notice.daysOverdue} days overdue. Our records show an open balance of ${formatMinor(notice.balanceMinor, currency)}.`,
    )
    doc.moveDown(1)
    const rows: Array<[string, number]> = [['Open balance', notice.balanceMinor]]
    if (notice.feeMinor > 0) rows.push([`Reminder fee (level ${notice.level})`, notice.feeMinor])
    if (notice.interestMinor > 0) rows.push(['Late-payment interest to date', notice.interestMinor])
    rows.push(['Amount due', notice.balanceMinor + notice.feeMinor + notice.interestMinor])
    for (const [label, amount] of rows) {
      const rowY = doc.y
      doc.text(label, 50, rowY, { width: 300 })
      doc.text(formatMinor(amount, currency), 400, rowY, { width: 145, align: 'right' })
      doc.moveDown(0.3)
    }
    doc.x = 50
    doc.moveDown(1.5)
    doc.text(
      notice.template === 'final_notice'
        ? `If the amount is not received by ${notice.respondBy}, the claim will be handed to collection without further notice, and the costs of collection will be added.`
        : `Please settle the amount by ${notice.respondBy}. If you have already paid, please disregard this letter.`,
    )
    doc.moveDown(2).text('Kind regards,').text(tenant.name)
  })
}
