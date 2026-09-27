import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { JwtPayload } from './jwt.strategy';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  return ctx.switchToHttp().getRequest().user;
});
