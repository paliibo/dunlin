import { timingSafeEqual } from 'node:crypto'

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { UnauthorizedError } from '../common/errors.js'
import { ENV, type Env } from '../config/env.js'
import { ApiKeysService } from './api-keys.service.js'
import { IS_PUBLIC, PLATFORM_ONLY } from './decorators.js'
import type { RequestWithPrincipal } from './principal.js'

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Authenticates every request unless the handler opts out. Sets
 * `request.principal`, which the tenant interceptor and the role guard read.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>()

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, targets)) {
      const token = request.header('x-platform-token')
      if (!token || !constantTimeEquals(token, this.env.PLATFORM_TOKEN)) {
        throw new UnauthorizedError(
          'platform_token_required',
          'A valid X-Platform-Token header is required',
        )
      }
      request.principal = { kind: 'platform' }
      return true
    }

    const header = request.header('authorization') ?? ''
    const plaintext = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (!plaintext) {
      throw new UnauthorizedError('api_key_required', 'Send the API key as a Bearer token')
    }
    const principal = await this.apiKeys.authenticate(plaintext)
    if (!principal)
      throw new UnauthorizedError('invalid_api_key', 'The API key is unknown or revoked')

    request.principal = principal
    return true
  }
}
