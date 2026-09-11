import { randomUUID } from 'node:crypto'

import { Injectable, type LoggerService } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { type Logger, pino } from 'pino'

import type { Env } from '../config/env.js'

export const LOGGER = Symbol('LOGGER')

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers["x-platform-token"]'],
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  })
}

/** Nest's LoggerService over pino, so framework and application lines share one JSON stream. */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context)
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace)
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context)
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context)
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context)
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace',
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    const fields: Record<string, unknown> = { context }
    if (trace) fields.trace = trace
    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message)
    } else if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...fields, ...(message as Record<string, unknown>) })
    } else {
      this.logger[level](fields, String(message))
    }
  }
}

export type RequestWithId = Request & {
  id?: string
  principal?: { kind: string; tenantId?: string; keyId?: string }
}

/**
 * One line per request, after it finishes, with the id that the error body
 * and every log line in between also carry. Health checks are left out: an
 * orchestrator polling every few seconds is noise, not signal.
 */
export function requestLogger(logger: Logger) {
  return (req: RequestWithId, res: Response, next: NextFunction): void => {
    const id = (req.header('x-request-id') ?? randomUUID()).slice(0, 100)
    req.id = id
    res.setHeader('X-Request-Id', id)
    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      if (req.path === '/health') return
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      logger.info(
        {
          requestId: id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          tenantId: req.principal?.tenantId,
          keyId: req.principal?.keyId,
        },
        `${req.method} ${req.path} ${res.statusCode}`,
      )
    })
    next()
  }
}
