import { Module } from '@nestjs/common'

import { PaymentsModule } from '../payments/payments.module.js'
import { BankImportsController } from './bank-imports.controller.js'
import { BankImportsService } from './bank-imports.service.js'

@Module({
  imports: [PaymentsModule],
  controllers: [BankImportsController],
  providers: [BankImportsService],
  exports: [BankImportsService],
})
export class BankImportsModule {}
