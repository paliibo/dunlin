import { SetMetadata } from '@nestjs/common'

export const IDEMPOTENT = 'dunlin:idempotent'

/**
 * Marks a mutating handler as safe to replay: with an `Idempotency-Key`
 * header, a repeated request returns the first response instead of acting
 * twice. See IdempotencyInterceptor.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true)
