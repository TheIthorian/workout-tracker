import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpToolDefinition } from './tool-definition.js';

/** Name and version this server reports in the `initialize` handshake. */
const SERVER_INFO = { name: 'app-mcp', version: '1.0.0' };

/**
 * Builds the MCP server for one request, with every tool already bound to that request's
 * workspace-scoped context.
 *
 * A server per request means nothing is carried between calls, so there is no session to resume and
 * no cross-request state one token could reach through another's connection.
 */
export function createMcpServer({
    tools,
    instructions,
}: {
    tools: McpToolDefinition[];
    instructions: string;
}): McpServer {
    const server = new McpServer(SERVER_INFO, { instructions });

    for (const tool of tools) {
        server.registerTool(
            tool.name,
            { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
            async (args: unknown) => tool.handler(args),
        );
    }

    return server;
}

/**
 * The text clients show the model after `initialize`. Rewrite it to describe your own resources -
 * it is the model's only description of what this server is for, and nothing else in the protocol
 * conveys the workspace-pinning rule below.
 */
export function buildServerInstructions({ webAppBaseUrl }: { webAppBaseUrl: string }): string {
    return (
        'Workspace assistant. Use these tools to read and manage items in a workspace. ' +
        'This server is scoped to one workspace by the MCP URL token, so do not pass workspaceId to tools. ' +
        "Item responses carry a webUrl for the item's page in the web app; link to that rather than " +
        `quoting a bare id. The pattern is ${webAppBaseUrl}/workspaces/{workspaceId}/items/{itemId}, ` +
        'and list_workspaces returns the workspaceId this token is scoped to.'
    );
}
