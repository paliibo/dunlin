import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe-style signatures: `t=<unix seconds>,v1=<hex hmac-sha256(secret, "t.body")>`.
 * The timestamp is part of what is signed, so a captured request cannot be
 * replayed later — receivers reject anything older than a few minutes.
 */
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${sign(secret, timestamp, body)}`
}

export function verifySignature(
  secret: string,
  header: string | undefined,
  body: string,
  { toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } = {},
): boolean {
  if (!header) return false
  const parts = new Map(header.split(',').map((part) => part.split('=') as [string, string]))
  const timestamp = Number(parts.get('t'))
  const given = parts.get('v1')
  if (!Number.isInteger(timestamp) || !given) return false
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false
  const expected = sign(secret, timestamp, body)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(given, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
