import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import type { AuthenticatedRequest, CurrentUserContext } from './session-auth.guard.js';

/**
 * The decorator factory, exported separately so a test can call it directly without going through
 * Nest's parameter-decorator machinery.
 *
 * @throws UnauthorizedError when `request.currentUser` is absent - that means `SessionAuthGuard`
 * was never applied to this route, a wiring bug that must fail loudly rather than silently handing
 * the controller `undefined`.
 */
export function extractCurrentUser(_data: unknown, context: ExecutionContext): CurrentUserContext {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.currentUser) throw new UnauthorizedError();

    return request.currentUser;
}

/** `@CurrentUser()` - the replacement for `CurrentUserService.UserId`. */
export const CurrentUser = createParamDecorator(extractCurrentUser);
