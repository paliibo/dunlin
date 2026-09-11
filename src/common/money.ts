/**
 * Money is integer minor units (cents, rappen, öre) end to end. Floats never
 * touch an amount: quantities arrive with at most three decimals and are
 * turned into thousandths before any multiplication, so every intermediate
 * value is an integer well inside Number's exact range.
 */
export type Minor = number

export const MAX_MINOR = Number.MAX_SAFE_INTEGER

/** Commercial rounding: halves go away from zero. */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1
  return sign * Math.floor(Math.abs(value) + 0.5)
}

export function assertMinor(value: number, what = 'amount'): void {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_MINOR) {
    throw new RangeError(`${what} must be an integer amount in minor units`)
  }
}

export interface LineInput {
  /** Up to three decimals, e.g. 1.5 hours or 12.25 kg. */
  quantity: number
  unitPriceMinor: Minor
  /** Basis points: 2000 is 20 %. */
  taxRateBps: number
}

export interface LineAmounts {
  netMinor: Minor
  taxMinor: Minor
  totalMinor: Minor
}

export function quantityToThousandths(quantity: number): number {
  const thousandths = Math.round(quantity * 1000)
  if (!Number.isFinite(thousandths) || Math.abs(quantity * 1000 - thousandths) > 1e-6) {
    throw new RangeError('quantity may have at most three decimal places')
  }
  return thousandths
}

/**
 * Per-line: net rounded once, tax rounded once on the rounded net. Summing
 * rounded lines is what appears on the printed document and what customers
 * check with a calculator, so it is what the totals are.
 */
export function lineAmounts(line: LineInput): LineAmounts {
  assertMinor(line.unitPriceMinor, 'unitPriceMinor')
  if (!Number.isInteger(line.taxRateBps) || line.taxRateBps < 0 || line.taxRateBps > 10_000) {
    throw new RangeError('taxRateBps must be an integer between 0 and 10000')
  }
  const thousandths = quantityToThousandths(line.quantity)
  const netMinor = roundHalfUp((thousandths * line.unitPriceMinor) / 1000)
  const taxMinor = roundHalfUp((netMinor * line.taxRateBps) / 10_000)
  return { netMinor, taxMinor, totalMinor: netMinor + taxMinor }
}

export interface Totals {
  subtotalMinor: Minor
  taxMinor: Minor
  totalMinor: Minor
}

export function sumTotals(lines: readonly LineAmounts[]): Totals {
  let subtotalMinor = 0
  let taxMinor = 0
  for (const line of lines) {
    subtotalMinor += line.netMinor
    taxMinor += line.taxMinor
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor }
}

/**
 * Simple (not compound) interest on an outstanding balance, the way statutory
 * late-payment interest is usually stated: an annual rate, pro rata by day.
 */
export function simpleInterest(principalMinor: Minor, annualRateBps: number, days: number): Minor {
  assertMinor(principalMinor, 'principalMinor')
  if (days <= 0 || annualRateBps <= 0 || principalMinor <= 0) return 0
  return roundHalfUp((principalMinor * annualRateBps * days) / (10_000 * 365))
}

const formatters = new Map<string, Intl.NumberFormat>()

/** "1 234,50 CHF" style rendering for documents and mail. Never used for arithmetic. */
export function formatMinor(minor: Minor, currency: string, locale = 'de-CH'): string {
  const key = `${locale}:${currency}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    })
    formatters.set(key, formatter)
  }
  return formatter.format(minor / 100)
}
