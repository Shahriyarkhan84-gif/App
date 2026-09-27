import { SetMetadata } from '@nestjs/common';
import type { AppRole } from '@zynalive/database';

export const ROLES_KEY = 'roles';

/** Route/handler is only reachable by these roles. Combine with JwtAuthGuard. */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

// Mirrors public.is_platform_admin() in supabase/migrations/20260924010000_core.sql.
export const PLATFORM_ADMIN_ROLES: AppRole[] = ['OWNER_ADMIN', 'SUPER_ADMIN'];
