import { clampLimit, decodeCursor, encodeCursor } from './pagination.js'

describe('cursor', () => {
  it('round-trips', () => {
    const cursor = {
      createdAt: '2026-09-11T10:00:00.000Z',
      id: '3f5c9c2e-1b7a-4f5c-9a5e-0d6b6b7a8c9d',
    }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('is null when absent and rejects garbage', () => {
    expect(decodeCursor(undefined)).toBeNull()
    expect(() => decodeCursor('not-a-cursor')).toThrow(/cursor/i)
    expect(() => decodeCursor(Buffer.from('{"x":1}').toString('base64url'))).toThrow(/cursor/i)
  })
})

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(50)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(7.9)).toBe(7)
    expect(clampLimit(1_000)).toBe(100)
  })
})
