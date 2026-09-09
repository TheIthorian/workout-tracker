import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import type { McpAuthenticatedRequest, McpContext } from './mcp-pat-auth.guard.js';

/**
 * The decorator factory, exported separately so a test can call it directly without going through
 * Nest's parameter-decorator machinery.
 *
 * @throws UnauthorizedError when `request.mcpContext` is absent - that means `McpPatAuthGuard` was
 * never applied to this route, a wiring bug that must fail loudly rather than silently handing the
 * controller `undefined`.
 */
export function extractMcpSession(_data: unknown, context: ExecutionContext): McpContext {
    const request = context.switchToHttp().getRequest<McpAuthenticatedRequest>();

    if (!request.mcpContext) throw new UnauthorizedError();

    return request.mcpContext;
}

/** `@McpSession()` - reads the `McpContext` a PAT guard attached to the request. */
export const McpSession = createParamDecorator(extractMcpSession);
