import { DEFAULT_DUNNING_POLICY, dunningPolicySchema } from '../tenants/dunning-policy.js'
import { type DunnableInvoice, planEscalation } from './policy.js'

const overdue = (patch: Partial<DunnableInvoice> = {}): DunnableInvoice => ({
  status: 'issued',
  dueOn: '2026-09-01',
  dunningLevel: 0,
  dunningPaused: false,
  balanceMinor: 100_000,
  ...patch,
})

describe('planEscalation', () => {
  it('waits for the first level delay', () => {
    expect(planEscalation(overdue(), DEFAULT_DUNNING_POLICY, '2026-09-03')).toBeNull()
    const plan = planEscalation(overdue(), DEFAULT_DUNNING_POLICY, '2026-09-04')
    expect(plan).toMatchObject({ level: 1, daysOverdue: 3, feeMinor: 0, respondBy: '2026-09-14' })
  })

  it('climbs one level per scan, in order, however late the scan is', () => {
    const plan = planEscalation(overdue(), DEFAULT_DUNNING_POLICY, '2026-12-01')
    expect(plan?.level).toBe(1)
    const next = planEscalation(overdue({ dunningLevel: 1 }), DEFAULT_DUNNING_POLICY, '2026-12-01')
    expect(next).toMatchObject({ level: 2, feeMinor: 1_500 })
  })

  it('charges interest on the balance for the days overdue', () => {
    // 1000.00 at 5 % for 30 days = 4.11
    const plan = planEscalation(overdue({ dunningLevel: 2 }), DEFAULT_DUNNING_POLICY, '2026-10-01')
    expect(plan).toMatchObject({ level: 3, daysOverdue: 30, feeMinor: 4_000, interestMinor: 411 })
  })

  it('stops after the last level', () => {
    expect(
      planEscalation(overdue({ dunningLevel: 3 }), DEFAULT_DUNNING_POLICY, '2027-01-01'),
    ).toBeNull()
  })

  it('skips paused, settled, draft and void invoices', () => {
    expect(
      planEscalation(overdue({ dunningPaused: true }), DEFAULT_DUNNING_POLICY, '2026-12-01'),
    ).toBeNull()
    expect(
      planEscalation(overdue({ balanceMinor: 0 }), DEFAULT_DUNNING_POLICY, '2026-12-01'),
    ).toBeNull()
    expect(
      planEscalation(
        overdue({ status: 'draft', dueOn: null }),
        DEFAULT_DUNNING_POLICY,
        '2026-12-01',
      ),
    ).toBeNull()
    expect(
      planEscalation(overdue({ status: 'void' }), DEFAULT_DUNNING_POLICY, '2026-12-01'),
    ).toBeNull()
  })

  it('honours a grace period', () => {
    const policy = { ...DEFAULT_DUNNING_POLICY, graceDays: 5 }
    expect(planEscalation(overdue(), policy, '2026-09-08')).toBeNull()
    expect(planEscalation(overdue(), policy, '2026-09-09')?.level).toBe(1)
  })
})

describe('dunningPolicySchema', () => {
  it('accepts the default and fills in defaults', () => {
    expect(dunningPolicySchema.parse(DEFAULT_DUNNING_POLICY)).toEqual(DEFAULT_DUNNING_POLICY)
    expect(
      dunningPolicySchema.parse({ levels: [{ afterDays: 7, feeMinor: 0, template: 'reminder' }] }),
    ).toMatchObject({
      graceDays: 0,
      interestRateBps: 500,
      responseDays: 10,
    })
  })

  it('rejects levels that do not escalate', () => {
    const result = dunningPolicySchema.safeParse({
      levels: [
        { afterDays: 14, feeMinor: 0, template: 'reminder' },
        { afterDays: 7, feeMinor: 100, template: 'second_reminder' },
      ],
    })
    expect(result.success).toBe(false)
  })
})
