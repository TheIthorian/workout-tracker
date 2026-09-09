import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import { describe, expect, it } from 'vitest';
import { extractCurrentUser } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './session-auth.guard.js';

describe('extractCurrentUser', () => {
    it('returns request.currentUser when present', () => {
        const currentUser = { userId: 'user-1', email: 'a@example.com' };
        const context = makeContext({ currentUser } as AuthenticatedRequest);

        expect(extractCurrentUser(undefined, context)).toEqual(currentUser);
    });

    // An absent currentUser means SessionAuthGuard was never applied to this route - a wiring
    // bug that must fail loudly rather than silently handing the controller `undefined`.
    it('throws UnauthorizedError when currentUser is absent', () => {
        const context = makeContext({} as AuthenticatedRequest);

        expect(() => extractCurrentUser(undefined, context)).toThrow(UnauthorizedError);
    });
});

function makeContext(request: AuthenticatedRequest): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;
}
