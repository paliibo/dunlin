import { matchLine, normalizeToken, type OpenInvoiceCandidate } from './matcher.js'

const open: OpenInvoiceCandidate[] = [
  {
    id: 'a',
    number: 'INV-2026-0001',
    customerName: 'Muster GmbH',
    balanceMinor: 43_200,
    currency: 'CHF',
  },
  {
    id: 'b',
    number: 'INV-2026-0002',
    customerName: 'Muster GmbH',
    balanceMinor: 43_200,
    currency: 'CHF',
  },
  {
    id: 'c',
    number: 'INV-2026-0003',
    customerName: 'Beispiel AG',
    balanceMinor: 10_000,
    currency: 'CHF',
  },
]

describe('normalizeToken', () => {
  it('drops case, spaces and punctuation', () => {
    expect(normalizeToken(' inv-2026 / 0001 ')).toBe('INV20260001')
    expect(normalizeToken(null)).toBe('')
  })
})

describe('matchLine', () => {
  it('matches on an invoice number in the reference, whatever the formatting', () => {
    const result = matchLine(
      {
        amountMinor: 9_000,
        currency: 'CHF',
        counterparty: 'somebody',
        reference: 'Zahlung inv 2026/0003',
      },
      open,
    )
    expect(result).toEqual({ kind: 'match', invoiceId: 'c', reason: 'reference' })
  })

  it('refuses a referenced invoice when the amount exceeds its balance', () => {
    expect(
      matchLine(
        { amountMinor: 10_001, currency: 'CHF', counterparty: null, reference: 'INV-2026-0003' },
        open,
      ),
    ).toEqual({
      kind: 'no_match',
      reason: 'amount_exceeds_balance',
    })
  })

  it('calls two referenced invoices ambiguous', () => {
    expect(
      matchLine(
        {
          amountMinor: 100,
          currency: 'CHF',
          counterparty: null,
          reference: 'INV-2026-0001 INV-2026-0003',
        },
        open,
      ),
    ).toEqual({ kind: 'no_match', reason: 'ambiguous_reference' })
  })

  it('falls back to the exact balance from the named counterparty', () => {
    expect(
      matchLine(
        { amountMinor: 10_000, currency: 'CHF', counterparty: 'BEISPIEL AG', reference: null },
        open,
      ),
    ).toEqual({
      kind: 'match',
      invoiceId: 'c',
      reason: 'amount_and_counterparty',
    })
  })

  it('will not guess between two invoices with the same balance and customer', () => {
    expect(
      matchLine(
        { amountMinor: 43_200, currency: 'CHF', counterparty: 'Muster GmbH', reference: 'thanks' },
        open,
      ),
    ).toEqual({
      kind: 'no_match',
      reason: 'ambiguous_amount',
    })
  })

  it('reports debits, foreign currency and strangers', () => {
    expect(
      matchLine({ amountMinor: -500, currency: 'CHF', counterparty: null, reference: null }, open)
        .kind,
    ).toBe('no_match')
    expect(
      matchLine(
        { amountMinor: 10_000, currency: 'EUR', counterparty: 'Beispiel AG', reference: null },
        open,
      ),
    ).toEqual({
      kind: 'no_match',
      reason: 'currency_mismatch',
    })
    expect(
      matchLine(
        { amountMinor: 10_000, currency: 'CHF', counterparty: 'Unknown Ltd', reference: null },
        open,
      ),
    ).toEqual({
      kind: 'no_match',
      reason: 'no_match',
    })
  })

  it('ignores invoices with nothing left to pay', () => {
    const settled = [{ ...open[2]!, balanceMinor: 0 }]
    expect(
      matchLine(
        { amountMinor: 1, currency: 'CHF', counterparty: null, reference: 'INV-2026-0003' },
        settled,
      ),
    ).toEqual({
      kind: 'no_match',
      reason: 'no_match',
    })
  })
})
