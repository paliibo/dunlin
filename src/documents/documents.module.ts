import { Global, Module } from '@nestjs/common'

import { DocumentsService } from './documents.service.js'

@Global()
@Module({
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
