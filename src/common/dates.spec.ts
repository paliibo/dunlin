import { addDays, daysBetween, isIsoDate, toIsoDate, yearOf } from './dates.js'

describe('isIsoDate', () => {
  it.each(['2026-09-11', '2024-02-29', '2000-01-01'])('accepts %s', (value) => {
    expect(isIsoDate(value)).toBe(true)
  })

  it.each([
    '2026-13-01',
    '2026-02-30',
    '2023-02-29',
    '26-09-11',
    '2026-9-1',
    'today',
    20260911,
    null,
  ])('rejects %p', (value) => {
    expect(isIsoDate(value)).toBe(false)
  })
})

describe('addDays and daysBetween', () => {
  it('cross month and year boundaries', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14)
    expect(daysBetween('2027-01-08', '2026-12-25')).toBe(-14)
  })

  it('ignore daylight-saving transitions', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('toIsoDate and yearOf', () => {
  it('use the UTC calendar', () => {
    expect(toIsoDate(new Date('2026-09-11T23:59:59Z'))).toBe('2026-09-11')
    expect(yearOf('2026-09-11')).toBe(2026)
  })
})
