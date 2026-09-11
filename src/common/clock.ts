import { Injectable } from '@nestjs/common'

import { type IsoDate, toIsoDate } from './dates.js'

/** Injectable "now", so a test can freeze the calendar without touching the system clock. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date()
  }

  today(): IsoDate {
    return toIsoDate(this.now())
  }
}
