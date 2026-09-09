import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Hands one HTTP request to the MCP Streamable HTTP transport.
 *
 * Two Fastify-specific details are load-bearing:
 *
 * 1. `reply.hijack()` - the SDK writes headers and body straight to the raw Node response. Without
 *    hijacking, Fastify would also try to send its own reply and the response would be written
 *    twice.
 * 2. `request.body` is passed as the already-parsed body. Fastify has consumed the request stream
 *    by the time a handler runs, so a transport left to read `req` itself would hang forever.
 *
 * The transport and server are closed when the response closes rather than immediately after
 * `handleRequest` resolves: in SSE mode the response outlives that call, and closing early would
 * truncate it.
 */
export async function handleMcpRequest({
    request,
    reply,
    server,
}: {
    request: FastifyRequest;
    reply: FastifyReply;
    server: McpServer;
}): Promise<void> {
    // No `sessionIdGenerator`: session management off, so every request is self-contained and one
    // token's connection can never resume state left by another's.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on('close', () => {
        void transport.close();
        void server.close();
    });

    reply.hijack();

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
}
