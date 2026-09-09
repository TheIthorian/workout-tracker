import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import { McpPatAuthGuard } from './mcp-pat-auth.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

/**
 * Accepts EITHER a browser session cookie or an MCP personal access token, for the routes that
 * serve both the SPA and `apps/mcp`. Nest's `@UseGuards(A, B)` requires every guard to pass, so an
 * OR has to be written as one guard.
 *
 * The session is tried first because it is the overwhelmingly common case and costs one call to an
 * already-warm session store; the token path only runs when there is no session to find.
 *
 * Whichever succeeds leaves `currentUser` attached, so handlers are identical either way. Only the
 * PAT path additionally attaches `mcpContext`, and only its guard applies the workspace pin.
 */
@Injectable()
export class SessionOrMcpPatGuard implements CanActivate {
    constructor(
        private readonly session: SessionAuthGuard,
        private readonly pat: McpPatAuthGuard,
    ) {}

    /** Tries the session, then the token. Reports the token guard's failure, which is the more specific one. */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (await this.tryGuard(this.session, context)) return true;

        return this.pat.canActivate(context);
    }

    /**
     * A failed session is not an error here - it is the signal to try the other credential - so an
     * `UnauthorizedError` is swallowed. Every other error propagates: a session store that is down
     * must not be reported to the caller as "your token is invalid".
     */
    private async tryGuard(guard: CanActivate, context: ExecutionContext): Promise<boolean> {
        try {
            return (await guard.canActivate(context)) === true;
        } catch (error) {
            if (error instanceof UnauthorizedError) return false;

            throw error;
        }
    }
}
