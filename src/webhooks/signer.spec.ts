import { sign, signatureHeader, verifySignature } from './signer.js'

const secret = 'whsec_test'
const body = '{"id":"evt_1","type":"invoice.paid"}'

describe('webhook signatures', () => {
  it('verifies what it signed, within the tolerance window', () => {
    const header = signatureHeader(secret, 1_800_000_000, body)
    expect(header).toBe(`t=1800000000,v1=${sign(secret, 1_800_000_000, body)}`)
    expect(verifySignature(secret, header, body, { nowSeconds: 1_800_000_100 })).toBe(true)
  })

  it('rejects a tampered body, a wrong secret and a stale timestamp', () => {
    const header = signatureHeader(secret, 1_800_000_000, body)
    expect(verifySignature(secret, header, body + ' ', { nowSeconds: 1_800_000_100 })).toBe(false)
    expect(verifySignature('other', header, body, { nowSeconds: 1_800_000_100 })).toBe(false)
    expect(verifySignature(secret, header, body, { nowSeconds: 1_800_001_000 })).toBe(false)
  })

  it('rejects malformed headers without throwing', () => {
    expect(verifySignature(secret, undefined, body)).toBe(false)
    expect(verifySignature(secret, 'v1=abc', body)).toBe(false)
    expect(verifySignature(secret, 't=notanumber,v1=zz', body)).toBe(false)
  })
})
