import { createLogger, type Logger } from '@app/logger';
import { RESOURCE_URL_GENERATOR, ResourceUrlGenerator } from '@app/nest-common';
import type { Provider } from '@nestjs/common';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

/** DI token for the application-wide {@link Logger}. */
export const APP_LOGGER = Symbol('APP_LOGGER');

/**
 * Infrastructure this app composes from packages. Deliberately shorter than `apps/api`'s: every
 * tool reaches `apps/api` over HTTP through `ApiClient` (`mcp.providers.ts`), so this process holds
 * no database pool, no Better Auth configuration and no object-storage or LLM client at all.
 */
export const infrastructureProviders: Provider[] = [
    {
        provide: APP_LOGGER,
        useFactory: (): Logger => createLogger({ context: 'mcp', config: toLoggerConfig(loadEnv()) }),
    },
    // The same generator `apps/api` builds from the same settings, so a resource reached through a
    // tool carries the identical links to one reached through the REST API.
    {
        provide: RESOURCE_URL_GENERATOR,
        useFactory: (): ResourceUrlGenerator => {
            const env = loadEnv();

            return new ResourceUrlGenerator({
                config: {
                    webAppBaseUrl: String(env['WEB_APP_BASE_URL']),
                    apiBaseUrl: String(env['API_BASE_URL']),
                    mcpBaseUrl: String(env['MCP_BASE_URL']),
                },
            });
        },
    },
];
