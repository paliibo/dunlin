import 'reflect-metadata'

import { loadEnv } from '../config/env.js'
import { createDataSource } from './data-source.js'

/** `pnpm db:migrate` — apply pending migrations and exit. */
const env = loadEnv()
const dataSource = createDataSource(env.DATABASE_URL)
await dataSource.initialize()
try {
  const applied = await dataSource.runMigrations({ transaction: 'all' })
  console.log(
    applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'Migrations up to date.',
  )
} finally {
  await dataSource.destroy()
}
