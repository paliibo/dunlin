import { addDays, daysBetween, type IsoDate } from '../common/dates.js'
import { simpleInterest } from '../common/money.js'
import { type InvoiceStatus, OPEN_STATUSES } from '../invoices/invoice.entity.js'
import type { DunningLevel, DunningPolicy } from '../tenants/dunning-policy.js'

export interface DunnableInvoice {
  status: InvoiceStatus
  dueOn: IsoDate | null
  dunningLevel: number
  dunningPaused: boolean
  balanceMinor: number
}

export interface Escalation {
  /** 1-based level being reached. */
  level: number
  definition: DunningLevel
  daysOverdue: number
  feeMinor: number
  interestMinor: number
  respondBy: IsoDate
}

/**
 * Whether an invoice is due for its next reminder on `asOf`, and what that
 * reminder charges. One level per scan, in order: an invoice that has been
 * ignored for ninety days still gets its first reminder before its final
 * notice, because that is what a court will ask to see.
 */
export function planEscalation(
  invoice: DunnableInvoice,
  policy: DunningPolicy,
  asOf: IsoDate,
): Escalation | null {
  if (!OPEN_STATUSES.includes(invoice.status) || invoice.dunningPaused || invoice.balanceMinor <= 0)
    return null
  if (invoice.dueOn === null) return null
  const definition = policy.levels[invoice.dunningLevel]
  if (!definition) return null

  const daysOverdue = daysBetween(invoice.dueOn, asOf)
  if (daysOverdue < policy.graceDays + definition.afterDays) return null

  return {
    level: invoice.dunningLevel + 1,
    definition,
    daysOverdue,
    feeMinor: definition.feeMinor,
    interestMinor: simpleInterest(invoice.balanceMinor, policy.interestRateBps, daysOverdue),
    respondBy: addDays(asOf, policy.responseDays),
  }
}
