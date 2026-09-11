import { Global, Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { TenantTransactionInterceptor } from '../tenancy/tenant-transaction.interceptor.js'
import { ApiKeyGuard } from './api-key.guard.js'
import { ApiKeysService } from './api-keys.service.js'
import { RateLimitGuard } from './rate-limit.guard.js'
import { RolesGuard } from './roles.guard.js'

/**
 * Order matters and is fixed here: authenticate (ApiKeyGuard), authorise
 * (RolesGuard), meter (RateLimitGuard), then open the tenant's transaction
 * (the interceptor) around the handler.
 */
@Global()
@Module({
  providers: [
    ApiKeysService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
  exports: [ApiKeysService],
})
export class AuthModule {}
