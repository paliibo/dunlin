import { Global, Module } from '@nestjs/common'

import { TenantContext } from './tenant-context.js'
import { UnitOfWork } from './unit-of-work.js'

@Global()
@Module({
  providers: [TenantContext, UnitOfWork],
  exports: [TenantContext, UnitOfWork],
})
export class TenancyModule {}
