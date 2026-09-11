import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ForbiddenError } from '../common/errors.js'
import type { Role } from './api-key.entity.js'
import { REQUIRED_ROLE } from './decorators.js'
import type { RequestWithPrincipal } from './principal.js'

const RANK: Record<Role, number> = { viewer: 0, accountant: 1, owner: 2 }

export function roleSatisfies(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required]
}

/** Runs after ApiKeyGuard; a handler without `@RequireRole` is open to every role. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required) return true

    const { principal } = context.switchToHttp().getRequest<RequestWithPrincipal>()
    if (!principal || principal.kind === 'platform') return true
    if (!roleSatisfies(principal.role, required)) {
      throw new ForbiddenError(
        `This action needs the ${required} role; the key has ${principal.role}`,
      )
    }
    return true
  }
}
