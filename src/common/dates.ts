/**
 * Calendar dates are `YYYY-MM-DD` strings, never Date objects: a due date has
 * no time zone, and the moment it becomes a Date it acquires one.
 */
export type IsoDate = string

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return toIsoDate(new Date(Date.UTC(y, m - 1, d + days)))
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4))
}
