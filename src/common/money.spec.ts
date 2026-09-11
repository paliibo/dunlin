import {
  formatMinor,
  lineAmounts,
  quantityToThousandths,
  roundHalfUp,
  simpleInterest,
  sumTotals,
} from './money.js'

describe('roundHalfUp', () => {
  it.each([
    [0.5, 1],
    [1.5, 2],
    [2.4999, 2],
    [-0.5, -1],
    [-1.4, -1],
    [0, 0],
  ])('rounds %p to %p, halves away from zero', (input, expected) => {
    expect(roundHalfUp(input)).toBe(expected)
  })
})

describe('quantityToThousandths', () => {
  it('accepts up to three decimals', () => {
    expect(quantityToThousandths(1.5)).toBe(1500)
    expect(quantityToThousandths(0.001)).toBe(1)
    expect(quantityToThousandths(12)).toBe(12_000)
  })

  it('rejects a fourth decimal', () => {
    expect(() => quantityToThousandths(1.0001)).toThrow(RangeError)
  })
})

describe('lineAmounts', () => {
  it('computes net, tax and total for a whole quantity', () => {
    expect(lineAmounts({ quantity: 2, unitPriceMinor: 1_999, taxRateBps: 2_000 })).toEqual({
      netMinor: 3_998,
      taxMinor: 800,
      totalMinor: 4_798,
    })
  })

  it('rounds a fractional quantity once, then taxes the rounded net', () => {
    // 1.5 × 10.01 = 15.015 → 15.02 net; 8.1 % of 15.02 = 1.21662 → 1.22
    expect(lineAmounts({ quantity: 1.5, unitPriceMinor: 1_001, taxRateBps: 810 })).toEqual({
      netMinor: 1_502,
      taxMinor: 122,
      totalMinor: 1_624,
    })
  })

  it('never produces a fractional minor unit', () => {
    for (let i = 0; i < 500; i++) {
      const quantity = Math.round(Math.random() * 100_000) / 1000
      const unitPriceMinor = Math.floor(Math.random() * 1_000_000)
      const taxRateBps = Math.floor(Math.random() * 2_500)
      const amounts = lineAmounts({ quantity: quantity || 0.001, unitPriceMinor, taxRateBps })
      expect(Number.isInteger(amounts.netMinor)).toBe(true)
      expect(Number.isInteger(amounts.taxMinor)).toBe(true)
      expect(amounts.totalMinor).toBe(amounts.netMinor + amounts.taxMinor)
    }
  })

  it('rejects non-integer prices and out-of-range rates', () => {
    expect(() => lineAmounts({ quantity: 1, unitPriceMinor: 10.5, taxRateBps: 0 })).toThrow(
      RangeError,
    )
    expect(() => lineAmounts({ quantity: 1, unitPriceMinor: 100, taxRateBps: 10_001 })).toThrow(
      RangeError,
    )
  })
})

describe('sumTotals', () => {
  it('adds rounded lines rather than re-rounding a grand total', () => {
    const lines = [
      lineAmounts({ quantity: 1, unitPriceMinor: 5, taxRateBps: 1_000 }), // tax 0.5 → 1
      lineAmounts({ quantity: 1, unitPriceMinor: 5, taxRateBps: 1_000 }),
      lineAmounts({ quantity: 1, unitPriceMinor: 5, taxRateBps: 1_000 }),
    ]
    expect(sumTotals(lines)).toEqual({ subtotalMinor: 15, taxMinor: 3, totalMinor: 18 })
  })
})

describe('simpleInterest', () => {
  it('is an annual rate applied pro rata by day', () => {
    // 1000.00 at 5 % for 73 days = 10.00
    expect(simpleInterest(100_000, 500, 73)).toBe(1_000)
  })

  it('rounds half up on the final amount', () => {
    // 123.45 at 5 % for 30 days = 0.5073… → 0.51
    expect(simpleInterest(12_345, 500, 30)).toBe(51)
  })

  it('is zero for no days, no rate or no balance', () => {
    expect(simpleInterest(100_000, 500, 0)).toBe(0)
    expect(simpleInterest(100_000, 0, 30)).toBe(0)
    expect(simpleInterest(0, 500, 30)).toBe(0)
    expect(simpleInterest(100_000, 500, -3)).toBe(0)
  })
})

describe('formatMinor', () => {
  it('renders minor units with the currency code', () => {
    expect(formatMinor(123_456, 'USD', 'en-US')).toMatch(/^USD\s1,234\.56$/)
    expect(formatMinor(123_456, 'CHF')).toMatch(/^CHF\s1.234\.56$/)
    expect(formatMinor(-500, 'EUR', 'en-IE')).toMatch(/^-EUR\s5\.00$/)
  })
})
