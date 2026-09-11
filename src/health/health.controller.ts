import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus'
import type { Redis } from 'ioredis'

import { Public } from '../auth/decorators.js'
import { REDIS } from '../queues/queues.module.js'

/**
 * Liveness with real dependency checks: a process that cannot reach Postgres
 * or Redis is not healthy, and saying so is how a bad deploy stays out of the
 * load balancer. Public, so an orchestrator can poll it without a key.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness, with database and Redis checks' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 2_000 }),
      async () => {
        const session = this.indicators.check('redis')
        try {
          const pong = await this.redis.ping()
          return pong === 'PONG'
            ? session.up()
            : session.down({ message: `unexpected reply ${pong}` })
        } catch (error) {
          return session.down({ message: error instanceof Error ? error.message : String(error) })
        }
      },
    ])
  }
}
