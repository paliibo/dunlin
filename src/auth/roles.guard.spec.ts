import { roleSatisfies } from './roles.guard.js'

describe('roleSatisfies', () => {
  it('nests owner ⊇ accountant ⊇ viewer', () => {
    expect(roleSatisfies('owner', 'viewer')).toBe(true)
    expect(roleSatisfies('owner', 'owner')).toBe(true)
    expect(roleSatisfies('accountant', 'owner')).toBe(false)
    expect(roleSatisfies('accountant', 'accountant')).toBe(true)
    expect(roleSatisfies('viewer', 'accountant')).toBe(false)
  })
})
