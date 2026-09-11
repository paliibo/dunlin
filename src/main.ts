import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module.js'
import { configureApp } from './app.setup.js'
import { loadEnv } from './config/env.js'
import { setupOpenApi } from './openapi/setup.js'

async function bootstrap(): Promise<void> {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule.forRole(env.DUNLIN_ROLE), { bufferLogs: true })
  configureApp(app)
  const logger = new Logger('Dunlin')

  if (env.DUNLIN_ROLE === 'worker') {
    await app.init()
    logger.log(`Worker ready (${env.NODE_ENV})`)
    return
  }

  setupOpenApi(app)
  await app.listen(env.PORT)
  logger.log(`${env.DUNLIN_ROLE} listening on :${env.PORT}, docs at /docs (${env.NODE_ENV})`)
}

await bootstrap()
