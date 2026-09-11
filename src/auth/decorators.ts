import { SetMetadata } from '@nestjs/common'

import type { Role } from './api-key.entity.js'

export const IS_PUBLIC = 'dunlin:public'
export const PLATFORM_ONLY = 'dunlin:platform'
export const REQUIRED_ROLE = 'dunlin:role'

/** No credentials at all — the health check. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** The platform token, not a tenant key: creating tenants and their first keys. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true)

/**
 * The least role that may call the handler. Roles nest — an owner can do
 * anything an accountant can — so one role names a floor, not a set.
 */
export const RequireRole = (role: Role) => SetMetadata(REQUIRED_ROLE, role)
