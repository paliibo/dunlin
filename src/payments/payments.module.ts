import { Module } from '@nestjs/common'

import { InvoicesModule } from '../invoices/invoices.module.js'
import { PaymentsController } from './payments.controller.js'
import { PaymentsService } from './payments.service.js'

@Module({
  imports: [InvoicesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
