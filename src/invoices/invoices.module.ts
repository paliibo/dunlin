import { Module } from '@nestjs/common'

import { InvoicesController } from './invoices.controller.js'
import { InvoicesService } from './invoices.service.js'
import { NumberingService } from './numbering.service.js'

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, NumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
