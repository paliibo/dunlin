import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'

import { DomainError } from './errors.js'

interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
  requestId?: string
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_failed',
  429: 'rate_limited',
}

/**
 * One error shape for everything: `{ error: { code, message, details? } }`.
 *
 * Domain errors keep their status and code. Nest's own exceptions (routing,
 * guards, throttling) are mapped by status. Anything else is a 500 with a
 * generic message — the real error is logged, never leaked.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request = http.getRequest<Request & { id?: string }>()
    const { status, body } = this.describe(exception)
    if (request.id) body.requestId = request.id
    if (status >= 500) this.logger.error(exception)
    response.status(status).json(body)
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: {
          error: { code: exception.code, message: exception.message, details: exception.details },
        },
      }
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const raw = exception.getResponse()
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message)
      return {
        status,
        body: {
          error: {
            code: STATUS_CODES[status] ?? 'error',
            message: Array.isArray(message) ? message.join('; ') : message,
          },
        },
      }
    }
    return {
      status: 500,
      body: { error: { code: 'internal_error', message: 'Something went wrong' } },
    }
  }
}
