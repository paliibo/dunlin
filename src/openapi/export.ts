import 'reflect-metadata'

import { writeFileSync } from 'node:fs'

import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module.js'
import { loadEnv } from '../config/env.js'
import { buildOpenApiDocument } from './setup.js'

/**
 * `pnpm openapi:export` — write openapi.json from the running module graph.
 * Needs the database and Redis, because the modules connect on boot.
 */
const env = loadEnv()
const app = await NestFactory.create(AppModule.forRole('api'), { logger: false })
await app.init()
const target = process.argv[2] ?? 'openapi.json'
writeFileSync(target, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n')
await app.close()
console.log(`Wrote ${target} for ${env.NODE_ENV}`)
