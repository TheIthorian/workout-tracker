import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import { describe, expect, it } from 'vitest';
import { extractMcpSession } from './mcp-session.decorator.js';
import type { McpAuthenticatedRequest } from './mcp-bearer-auth.guard.js';

describe('extractMcpSession', () => {
    it('returns request.mcpContext when present', () => {
        const mcpContext = { userId: 'user-1', workspaceId: 'workspace-1', token: 'tok' };
        const context = makeContext({ mcpContext } as McpAuthenticatedRequest);

        expect(extractMcpSession(undefined, context)).toEqual(mcpContext);
    });

    // An absent mcpContext means McpBearerAuthGuard was never applied to this route - a wiring bug
    // that must fail loudly rather than silently handing the controller `undefined`.
    it('throws UnauthorizedError when mcpContext is absent', () => {
        const context = makeContext({} as McpAuthenticatedRequest);

        expect(() => extractMcpSession(undefined, context)).toThrow(UnauthorizedError);
    });
});

function makeContext(request: McpAuthenticatedRequest): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;
}
