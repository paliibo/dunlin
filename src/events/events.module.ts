import { Global, Module } from '@nestjs/common'

import { DomainEvents } from './domain-events.service.js'

@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class EventsModule {}
