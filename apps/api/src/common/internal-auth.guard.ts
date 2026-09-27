import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stands in for Postgres's `service_role` in the original schema — the
 * `internal_*` RPCs there were revoked from `anon`/`authenticated` and
 * granted only to the service role, so only the AI worker / a trusted
 * backend job could call them. There's no equivalent built-in concept in a
 * plain NestJS app, so this checks a shared secret header instead. The AI
 * worker (agents/, currently pointed at Supabase) needs this same secret
 * once it's repointed at this API.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers['x-internal-secret'];
    const expected = this.config.getOrThrow<string>('INTERNAL_API_SECRET');
    if (!provided || provided !== expected) throw new UnauthorizedException();
    return true;
  }
}
