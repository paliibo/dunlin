import { z } from 'zod'

/**
 * How a tenant chases unpaid invoices. Levels escalate in order, one level per
 * scan, each with its own delay past the due date, flat fee and letter.
 */
export const dunningLevelSchema = z.object({
  /** Days past due (after the grace period) before this level is reached. */
  afterDays: z.number().int().min(0).max(365),
  /** Flat fee charged when this level is reached, in minor units. */
  feeMinor: z.number().int().min(0).max(10_000_000),
  /** Which letter to send; also the label shown on the notice. */
  template: z.enum(['reminder', 'second_reminder', 'final_notice']),
})

export const dunningPolicySchema = z
  .object({
    /** Days after the due date during which nothing happens. */
    graceDays: z.number().int().min(0).max(90).default(0),
    /** Annual late-payment interest applied pro rata to the open balance. */
    interestRateBps: z.number().int().min(0).max(5_000).default(500),
    /** Days the debtor is given to settle after a notice, printed on the letter. */
    responseDays: z.number().int().min(1).max(90).default(10),
    levels: z.array(dunningLevelSchema).min(1).max(5),
  })
  .refine(
    (policy) =>
      policy.levels.every(
        (level, i) => i === 0 || level.afterDays > policy.levels[i - 1]!.afterDays,
      ),
    { message: 'levels must be ordered by strictly increasing afterDays', path: ['levels'] },
  )

export type DunningPolicy = z.infer<typeof dunningPolicySchema>
export type DunningLevel = z.infer<typeof dunningLevelSchema>

/** A conventional three-step schedule: nudge, insist, threaten. */
export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  graceDays: 0,
  interestRateBps: 500,
  responseDays: 10,
  levels: [
    { afterDays: 3, feeMinor: 0, template: 'reminder' },
    { afterDays: 14, feeMinor: 1_500, template: 'second_reminder' },
    { afterDays: 30, feeMinor: 4_000, template: 'final_notice' },
  ],
}
