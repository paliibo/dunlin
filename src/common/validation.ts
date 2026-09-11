import { ValidationPipe, type ValidationError } from '@nestjs/common'

import { UnprocessableError } from './errors.js'

/** Flatten class-validator's tree into `{ 'lines.0.quantity': ['must be positive'] }`. */
export function flattenValidationErrors(
  errors: ValidationError[],
  prefix = '',
  into: Record<string, string[]> = {},
): Record<string, string[]> {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property
    if (error.constraints) into[path] = Object.values(error.constraints)
    if (error.children?.length) flattenValidationErrors(error.children, path, into)
  }
  return into
}

/**
 * Bodies are validated against their DTO classes; unknown fields are rejected
 * rather than silently dropped, so a typo in a field name fails fast instead
 * of quietly not applying.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new UnprocessableError(
        'validation_failed',
        'Request validation failed',
        flattenValidationErrors(errors),
      ),
  })
}
