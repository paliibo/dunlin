import { Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common'
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { ENV, type Env } from '../config/env.js'
import { dataSourceOptions } from './data-source.js'

/**
 * Pending migrations run when the process starts, unless a deploy pipeline
 * has already done it (`DB_MIGRATE_ON_BOOT=0`). Migrations are idempotent and
 * fast, and several instances starting at once serialise on the migrations
 * table's lock, so the simple rule holds everywhere from a laptop to a fleet.
 */
@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger(MigrationRunner.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.DB_MIGRATE_ON_BOOT) return
    const applied = await this.dataSource.runMigrations({ transaction: 'all' })
    if (applied.length > 0) {
      this.logger.log(
        `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`,
      )
    }
  }
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => dataSourceOptions(env.DATABASE_URL),
    }),
  ],
  providers: [MigrationRunner],
})
export class DatabaseModule {}
