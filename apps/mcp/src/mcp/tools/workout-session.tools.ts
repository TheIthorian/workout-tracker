import {
    completeSessionToolArgsSchema,
    getActiveSessionToolArgsSchema,
    getSessionToolArgsSchema,
    listSessionsToolArgsSchema,
    logSetToolArgsSchema,
    paginationQuerySchema,
    startSessionToolArgsSchema,
    type ActiveSessionResponse,
    type SessionDetailResponse,
    type SessionListResponse,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import type { Logger } from '@app/logger';
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { runToolCaught, serializeToolResult } from '../tool-execution.js';
import { attachWorkoutSessionLinks } from './workout-session-links.js';

/** Builds the MCP surface for reading and progressing workout sessions. */
export function buildWorkoutSessionTools({
    context,
    client,
    logger,
    urls,
}: {
    context: McpContext;
    client: ApiClient;
    logger: Logger;
    urls: ResourceUrlGenerator;
}): McpToolDefinition[] {
    const basePath = `/workspaces/${context.workspaceId}/sessions`;
    const withLinks = <T extends { id: string }>(session: T): T & { webUrl: string; resourceUrl: string } =>
        attachWorkoutSessionLinks({ urls, session, workspaceId: context.workspaceId });
    return [
        defineTool({
            methodName: 'ListSessions',
            description: 'Lists workout sessions, newest first.',
            inputSchema: listSessionsToolArgsSchema,
            handler: async (args) => {
                const page = paginationQuerySchema.parse({
                    page: args.page ?? undefined,
                    pageSize: args.pageSize ?? undefined,
                });
                const result = await client.get<SessionListResponse>({
                    path: basePath,
                    query: { page: page.page, pageSize: page.pageSize },
                });
                return serializeToolResult({ body: { ...result, data: result.data.map(withLinks) } });
            },
        }),
        defineTool({
            methodName: 'GetActiveSession',
            description: 'Gets the active workout session, if any.',
            inputSchema: getActiveSessionToolArgsSchema,
            handler: async () => {
                const { session } = await client.get<ActiveSessionResponse>({ path: `${basePath}/active` });
                return serializeToolResult({
                    body: session === null ? { active: false } : { active: true, session: withLinks(session) },
                });
            },
        }),
        defineTool({
            methodName: 'GetSession',
            description: 'Gets a session with its exercises, sets, and state.',
            inputSchema: getSessionToolArgsSchema,
            handler: async (args) =>
                serializeToolResult({
                    body: withLinks(await client.get<SessionDetailResponse>({ path: `${basePath}/${args.sessionId}` })),
                }),
        }),
        defineTool({
            methodName: 'StartSession',
            description: 'Starts a blank session or snapshots a routine into one active session.',
            inputSchema: startSessionToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'start_session',
                    logger,
                    action: async () =>
                        serializeToolResult({
                            body: withLinks(
                                await client.post<SessionDetailResponse>({ path: basePath, body: dropNullish(args) }),
                            ),
                        }),
                }),
        }),
        defineTool({
            methodName: 'LogSet',
            description: 'Logs the next set using canonical kilograms, metres, and seconds.',
            inputSchema: logSetToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'log_set',
                    logger,
                    action: async () => {
                        const { sessionId, sessionExerciseId, ...body } = args;
                        return serializeToolResult({
                            body: withLinks(
                                await client.post<SessionDetailResponse>({
                                    path: `${basePath}/${sessionId}/exercises/${sessionExerciseId}/sets`,
                                    body: dropNullish(body),
                                }),
                            ),
                        });
                    },
                }),
        }),
        defineTool({
            methodName: 'CompleteSession',
            description: 'Completes a session that has a working set.',
            inputSchema: completeSessionToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'complete_session',
                    logger,
                    action: async () =>
                        serializeToolResult({
                            body: withLinks(
                                await client.post<SessionDetailResponse>({
                                    path: `${basePath}/${args.sessionId}/complete`,
                                    body: args.notes === null || args.notes === undefined ? {} : { notes: args.notes },
                                }),
                            ),
                        }),
                }),
        }),
    ];
}

/** Removes nullish MCP arguments so API defaults remain authoritative. */
function dropNullish(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}
