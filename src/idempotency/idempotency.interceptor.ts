import { createHash } from 'node:crypto'

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import { from, mergeMap, type Observable, of } from 'rxjs'

import type { RequestWithPrincipal } from '../auth/principal.js'
import { ConflictError, UnprocessableError } from '../common/errors.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { IdempotencyKey } from './idempotency-key.entity.js'
import { IDEMPOTENT } from './idempotent.decorator.js'

const MAX_KEY_LENGTH = 200

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Runs inside the tenant transaction (it is registered after the transaction
 * interceptor). The key is claimed with `INSERT ... ON CONFLICT DO NOTHING`
 * before the handler runs: a concurrent request with the same key blocks on
 * the unique index until this one commits, then reads back the response.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: TenantContext,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const targets = [context.getHandler(), context.getClass()]
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, targets)) return next.handle()

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>()
    const key = request.header('idempotency-key')
    if (!key || request.principal?.kind !== 'tenant') return next.handle()
    if (key.length > MAX_KEY_LENGTH) {
      throw new UnprocessableError(
        'invalid_idempotency_key',
        `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
      )
    }

    const response = context.switchToHttp().getResponse<Response>()
    const fingerprint = createHash('sha256')
      .update(`${request.method} ${request.path} ${stableStringify(request.body)}`)
      .digest('hex')
    const tenantId = this.ctx.tenantId

    const claimed = (await this.ctx.manager.query(
      `insert into idempotency_keys (tenant_id, key, fingerprint) values ($1, $2, $3)
       on conflict (tenant_id, key) do nothing returning key`,
      [tenantId, key, fingerprint],
    )) as unknown[]

    if (claimed.length === 0) {
      const existing = await this.ctx.repo(IdempotencyKey).findOneBy({ key })
      if (!existing || existing.statusCode === null) {
        throw new ConflictError(
          'request_in_progress',
          'A request with this Idempotency-Key is still being processed',
        )
      }
      if (existing.fingerprint !== fingerprint) {
        throw new UnprocessableError(
          'idempotency_key_reused',
          'This Idempotency-Key was already used for a different request',
        )
      }
      response.status(existing.statusCode)
      response.setHeader('Idempotent-Replayed', 'true')
      return of(existing.response)
    }

    const statusCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method === 'POST' ? 201 : 200)

    return next
      .handle()
      .pipe(
        mergeMap((body: unknown) =>
          from(
            this.ctx.manager
              .query(
                `update idempotency_keys set status_code = $1, response = $2 where tenant_id = $3 and key = $4`,
                [statusCode, JSON.stringify(body ?? null), tenantId, key],
              )
              .then(() => body),
          ),
        ),
      )
  }
}
