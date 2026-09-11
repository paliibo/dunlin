import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Logger } from 'pino'

import { LOGGER, PinoLoggerService, requestLogger } from './common/logger.js'
import { createValidationPipe } from './common/validation.js'

/** Everything an application instance needs beyond its module graph; shared by main.ts and the test harness. */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(PinoLoggerService))
  app.enableShutdownHooks()
  app.useGlobalPipes(createValidationPipe())
  app.use(requestLogger(app.get<Logger>(LOGGER)))
  const express = app as NestExpressApplication
  express.set('trust proxy', 1)
  express.disable('x-powered-by')
}
