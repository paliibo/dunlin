import { Module } from '@nestjs/common'

import { PlatformTenantsController, TenantController } from './tenants.controller.js'
import { TenantsService } from './tenants.service.js'

@Module({
  controllers: [PlatformTenantsController, TenantController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
