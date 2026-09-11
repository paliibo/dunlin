import { formatMinor } from '../common/money.js'
import type { DunningNotice } from '../dunning/dunning-notice.entity.js'
import type { Invoice } from '../invoices/invoice.entity.js'
import type { Tenant } from '../tenants/tenant.entity.js'

export interface MailContent {
  subject: string
  text: string
}

const NOTICE_TITLES: Record<DunningNotice['template'], string> = {
  reminder: 'Payment reminder',
  second_reminder: 'Second payment reminder',
  final_notice: 'Final notice before collection',
}

export function invoiceIssuedMail(
  tenant: Tenant,
  invoice: Invoice,
  customerName: string,
  pdfUrl: string,
): MailContent {
  const total = formatMinor(invoice.totalMinor, invoice.currency)
  return {
    subject: `Invoice ${invoice.number} from ${tenant.name}: ${total} due ${invoice.dueOn}`,
    text: [
      `Dear ${customerName},`,
      '',
      `Please find invoice ${invoice.number} for ${total}, due on ${invoice.dueOn}.`,
      `The PDF is available at ${pdfUrl}`,
      '',
      `Kind regards,`,
      tenant.name,
    ].join('\n'),
  }
}

export function dunningNoticeMail(
  tenant: Tenant,
  invoice: Invoice,
  notice: DunningNotice,
  customerName: string,
  pdfUrl: string,
): MailContent {
  const balance = formatMinor(notice.balanceMinor, invoice.currency)
  const extras = notice.feeMinor + notice.interestMinor
  const lines = [
    `Dear ${customerName},`,
    '',
    `Invoice ${invoice.number} was due on ${invoice.dueOn} and is ${notice.daysOverdue} days overdue.`,
    `The open balance is ${balance}.`,
  ]
  if (notice.feeMinor > 0)
    lines.push(`A reminder fee of ${formatMinor(notice.feeMinor, invoice.currency)} applies.`)
  if (notice.interestMinor > 0) {
    lines.push(
      `Late-payment interest to date is ${formatMinor(notice.interestMinor, invoice.currency)}.`,
    )
  }
  if (extras > 0) {
    lines.push(`Total now due: ${formatMinor(notice.balanceMinor + extras, invoice.currency)}.`)
  }
  lines.push(
    '',
    `Please settle the amount by ${notice.respondBy}.`,
    notice.template === 'final_notice'
      ? 'If no payment is received by then, the claim will be handed to collection without further notice.'
      : 'If you have already paid, please disregard this message.',
    `The letter is available at ${pdfUrl}`,
    '',
    'Kind regards,',
    tenant.name,
  )
  return {
    subject: `${NOTICE_TITLES[notice.template]}: invoice ${invoice.number}`,
    text: lines.join('\n'),
  }
}
