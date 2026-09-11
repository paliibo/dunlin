import { UnprocessableError } from './errors.js'

/**
 * Keyset pagination over `(created_at desc, id desc)`. Offsets drift while rows
 * are being inserted; a cursor that names the last row seen does not.
 */
export interface Cursor {
  createdAt: string
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error()
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new UnprocessableError('invalid_cursor', 'The cursor is not one this API issued')
  }
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export function clampLimit(limit: number | undefined, fallback = 50, max = 100): number {
  if (limit === undefined) return fallback
  return Math.min(Math.max(1, Math.trunc(limit)), max)
}
