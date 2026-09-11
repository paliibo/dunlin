import type { Request } from 'express'

import type { Role } from './api-key.entity.js'

export type Principal =
  { kind: 'platform' } | { kind: 'tenant'; tenantId: string; role: Role; keyId: string }

export type RequestWithPrincipal = Request & { principal?: Principal; id?: string }
