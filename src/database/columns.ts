import type { ValueTransformer } from 'typeorm'

/**
 * Postgres returns bigint as a string, because a 64-bit value does not always
 * fit a double. Amounts here are bounded far below 2^53, so a number is safe
 * and far more pleasant than string arithmetic everywhere.
 */
export const bigintToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null) => (value === null ? null : Number(value)),
}

/** `numeric(12,3)` for quantities: also a string on the wire, also safe as a number. */
export const numericToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null) => (value === null ? null : Number(value)),
}
