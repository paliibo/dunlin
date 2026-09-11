import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import type { Redis } from 'ioredis'

import { DomainError } from '../common/errors.js'
import { ENV, type Env } from '../config/env.js'
import { REDIS } from '../queues/queues.module.js'
import { IS_PUBLIC } from './decorators.js'
import type { RequestWithPrincipal } from './principal.js'

export class RateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', `Too many requests; retry in ${retryAfterSeconds}s`, {
      retryAfterSeconds,
    })
  }
}

/**
 * A fixed window per minute, counted in Redis, keyed by the API key that made
 * the request — not the IP, which every request from one integration shares.
 * Runs after authentication, so an unauthenticated flood is bounded by the
 * (cheap) key lookup and never reaches a tenant's budget.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>()
    const response = context.switchToHttp().getResponse<Response>()
    const principal = request.principal
    const subject =
      principal?.kind === 'tenant'
        ? `key:${principal.keyId}`
        : principal?.kind === 'platform'
          ? 'platform'
          : `ip:${request.ip}`
    const limit = this.env.RATE_LIMIT_PER_MINUTE
    const window = Math.floor(Date.now() / 60_000)
    const key = `${this.env.QUEUE_PREFIX}:ratelimit:${subject}:${window}`

    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.expire(key, 60)

    response.setHeader('X-RateLimit-Limit', limit)
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count))
    if (count > limit) {
      const retryAfter = 60 - Math.floor((Date.now() % 60_000) / 1000)
      response.setHeader('Retry-After', retryAfter)
      throw new RateLimitedError(retryAfter)
    }
    return true
  }
}
