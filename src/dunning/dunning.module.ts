import { Module } from '@nestjs/common'

import { InvoicesModule } from '../invoices/invoices.module.js'
import { DunningController } from './dunning.controller.js'
import { DunningService } from './dunning.service.js'

@Module({
  imports: [InvoicesModule],
  controllers: [DunningController],
  providers: [DunningService],
  exports: [DunningService],
})
export class DunningModule {}
