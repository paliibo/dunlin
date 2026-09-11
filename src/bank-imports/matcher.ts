/**
 * Pure matching rules for one statement line against the tenant's open
 * invoices. No I/O, so every rule has a table test.
 */
export interface OpenInvoiceCandidate {
  id: string
  number: string
  customerName: string
  balanceMinor: number
  currency: string
}

export interface StatementLine {
  amountMinor: number
  currency: string
  counterparty: string | null
  reference: string | null
}

export type MatchReason = 'reference' | 'amount_and_counterparty'

export type NoMatchReason =
  | 'not_a_credit'
  | 'currency_mismatch'
  | 'ambiguous_reference'
  | 'amount_exceeds_balance'
  | 'ambiguous_amount'
  | 'no_match'

export type MatchResult =
  | { kind: 'match'; invoiceId: string; reason: MatchReason }
  | { kind: 'no_match'; reason: NoMatchReason }

/** Case, whitespace and punctuation are noise in a remittance field. */
export function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function matchLine(
  line: StatementLine,
  candidates: readonly OpenInvoiceCandidate[],
): MatchResult {
  if (line.amountMinor <= 0) return { kind: 'no_match', reason: 'not_a_credit' }

  const open = candidates.filter((c) => c.balanceMinor > 0)
  const sameCurrency = open.filter((c) => c.currency === line.currency)
  if (open.length > 0 && sameCurrency.length === 0)
    return { kind: 'no_match', reason: 'currency_mismatch' }

  // Rule 1: the remittance text names an invoice number.
  const reference = normalizeToken(line.reference)
  if (reference) {
    const named = sameCurrency.filter((c) => reference.includes(normalizeToken(c.number)))
    if (named.length > 1) return { kind: 'no_match', reason: 'ambiguous_reference' }
    if (named.length === 1) {
      const [candidate] = named as [OpenInvoiceCandidate]
      if (line.amountMinor > candidate.balanceMinor)
        return { kind: 'no_match', reason: 'amount_exceeds_balance' }
      return { kind: 'match', invoiceId: candidate.id, reason: 'reference' }
    }
  }

  // Rule 2: the exact open balance, from a counterparty whose name is the customer's.
  const counterparty = normalizeToken(line.counterparty)
  if (counterparty) {
    const exact = sameCurrency.filter(
      (c) => c.balanceMinor === line.amountMinor && normalizeToken(c.customerName) === counterparty,
    )
    if (exact.length > 1) return { kind: 'no_match', reason: 'ambiguous_amount' }
    if (exact.length === 1) {
      return {
        kind: 'match',
        invoiceId: (exact[0] as OpenInvoiceCandidate).id,
        reason: 'amount_and_counterparty',
      }
    }
  }

  return { kind: 'no_match', reason: 'no_match' }
}
