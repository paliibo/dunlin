/**
 * Domain errors carry a stable machine-readable code and the HTTP status they
 * map to. Services throw these; the exception filter turns them into the one
 * error shape every response uses.
 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id?: string) {
    super(404, 'not_found', id ? `${what} ${id} not found` : `${what} not found`)
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details)
  }
}

export class UnprocessableError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details)
  }
}

export class UnauthorizedError extends DomainError {
  constructor(code: string, message: string) {
    super(401, code, message)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'forbidden', message)
  }
}
