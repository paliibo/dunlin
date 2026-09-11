import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { from, lastValueFrom, type Observable } from 'rxjs'

import type { RequestWithPrincipal } from '../auth/principal.js'
import { UnitOfWork } from './unit-of-work.js'

/**
 * Wraps every tenant-authenticated request in a unit of work, so handlers and
 * services never open transactions or think about tenant ids themselves.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly uow: UnitOfWork) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>()
    const principal = request.principal
    if (!principal || principal.kind !== 'tenant') return next.handle()

    return from(
      this.uow.run(principal.tenantId, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    )
  }
}
