import { ApiClient } from '@app/api-client';
import type { Logger } from '@app/logger';
import { RESOURCE_URL_GENERATOR, ResourceUrlGenerator, type McpContext } from '@app/nest-common';
import type { Provider } from '@nestjs/common';
import { APP_LOGGER } from '../providers.js';
import { loadEnv } from '../config/load-env.js';
import { buildServerInstructions } from './mcp-server.js';
import { buildExerciseTools } from './tools/exercise.tools.js';
import { buildRoutineTools } from './tools/routine.tools.js';
import { buildSessionTools } from './tools/session.tools.js';
import { buildWorkoutSessionTools } from './tools/workout-session.tools.js';
import type { McpToolDefinition } from './tool-definition.js';

/** Builds every tool the server advertises, bound to one request's workspace-scoped context. */
export type McpToolFactory = (context: McpContext) => McpToolDefinition[];

/** DI token for the {@link McpToolFactory} provider below. */
export const MCP_TOOL_FACTORY = Symbol('MCP_TOOL_FACTORY');

/** DI token for the server instructions string sent after `initialize`. */
export const MCP_SERVER_INSTRUCTIONS = Symbol('MCP_SERVER_INSTRUCTIONS');

/**
 * Split out from `mcp.module.ts` for the same reason every slice in this monorepo does it: the
 * controller imports these tokens and the module imports the controller, so declaring them in the
 * module file would leave them `undefined` at `@Inject()` decoration time under ESM's
 * circular-import evaluation order.
 */
export const mcpProviders: Provider[] = [
    {
        provide: MCP_SERVER_INSTRUCTIONS,
        useFactory: (): string => buildServerInstructions({ webAppBaseUrl: String(loadEnv()['WEB_APP_BASE_URL']) }),
    },
    {
        provide: MCP_TOOL_FACTORY,
        useFactory: (logger: Logger, urls: ResourceUrlGenerator): McpToolFactory => {
            return (context: McpContext): McpToolDefinition[] => {
                // Built per request, not hoisted above this closure: the token IS the identity
                // (`ApiClient`'s own doc), and `context` - the argument this closure receives fresh
                // per MCP connection - is the only place that identity is available.
                const client = new ApiClient({
                    baseUrl: String(loadEnv()['API_INTERNAL_BASE_URL']),
                    token: context.token,
                });

                return [
                    ...buildSessionTools({ client }),
                    ...buildExerciseTools({ context, client, logger, urls }),
                    ...buildRoutineTools({ context, client, logger, urls }),
                    ...buildWorkoutSessionTools({ context, client, logger, urls }),
                ];
            };
        },
        inject: [APP_LOGGER, RESOURCE_URL_GENERATOR],
    },
];
