import { Global, Module } from '@nestjs/common'

import { ENV, type Env } from '../config/env.js'
import { Clock } from './clock.js'
import { createLogger, LOGGER, PinoLoggerService } from './logger.js'

@Global()
@Module({
  providers: [
    Clock,
    { provide: LOGGER, inject: [ENV], useFactory: (env: Env) => createLogger(env) },
    {
      provide: PinoLoggerService,
      inject: [LOGGER],
      useFactory: (logger: ReturnType<typeof createLogger>) => new PinoLoggerService(logger),
    },
  ],
  exports: [Clock, LOGGER, PinoLoggerService],
})
export class CommonModule {}
