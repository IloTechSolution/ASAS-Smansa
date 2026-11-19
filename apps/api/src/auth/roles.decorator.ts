import { SetMetadata } from '@nestjs/common';
import { Role } from '@cbt/shared';

/** Batasi route ke role tertentu. Dipakai bersama JwtAuthGuard + RolesGuard. */
export const ROLES_KEY = 'cbt_roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
