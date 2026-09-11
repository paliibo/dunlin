import pg from 'pg'
import { DataSource, type DataSourceOptions } from 'typeorm'

import { ENTITIES } from './entities.js'
import { Init1757548800000 } from './migrations/1757548800000-init.js'

// `date` columns stay the `YYYY-MM-DD` strings they are. node-postgres would
// otherwise turn them into Date objects at local midnight, which shifts the
// day for anyone west of Greenwich.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value)

export const MIGRATIONS = [Init1757548800000]

export function dataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'schema_migrations',
    synchronize: false,
    logging: false,
    extra: { max: 10 },
  }
}

export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource(dataSourceOptions(databaseUrl))
}
