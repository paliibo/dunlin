import { Global, Module } from '@nestjs/common'

import { ENV, type Env } from '../config/env.js'
import { MailController } from './mail.controller.js'
import { MailService } from './mail.service.js'
import { createMailTransport, MAIL_TRANSPORT } from './transport.js'

@Global()
@Module({
  controllers: [MailController],
  providers: [
    MailService,
    { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env) => createMailTransport(env) },
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
