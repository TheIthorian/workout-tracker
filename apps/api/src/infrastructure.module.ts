import { Global, Module } from '@nestjs/common';
import {
    MCP_TOKEN_SERVICE,
    McpPatAuthGuard,
    RESOURCE_URL_GENERATOR,
    SESSION_AUTH_SERVICE,
    SessionAuthGuard,
    SessionOrMcpPatGuard,
} from '@app/nest-common';
import {
    APP_LOGGER,
    AUTH_SERVICE,
    DB,
    infrastructureProviders,
    STORAGE_SERVICE,
    USER_PROVISIONING_SERVICE,
    WORKSPACE_MEMBERSHIP_SERVICE,
} from './providers.js';

/**
 * Provides the application's infrastructure tokens - the logger, the pooled `Db` handle, the
 * configured `AuthService`, `WorkspaceMembershipService`, the configured `StorageService`,
 * `SessionAuthGuard`'s `SESSION_AUTH_SERVICE` alias, `MCP_TOKEN_SERVICE`, and the session/token
 * guards themselves - to every feature module. `@Global()` plus `exports` makes these reachable
 * from every route-slice module without each one re-declaring or re-importing them.
 *
 * `SessionAuthGuard`, `McpPatAuthGuard` and `SessionOrMcpPatGuard` are exported here (rather than
 * left to Nest's per-controller `@UseGuards` auto-discovery) so every controller that references
 * them - directly or, for `SessionOrMcpPatGuard`, as a constructor dependency - resolves the same
 * instances from this one global container.
 *
 * Split out from `AppModule` so that module stays pure composition (imports only) while this one
 * owns everything infrastructure-shaped. A later slice module follows this same pattern only if it
 * introduces infrastructure of its own - most will just import `AppModule`'s existing feature
 * modules or `InfrastructureModule` directly.
 */
@Global()
@Module({
    providers: [...infrastructureProviders],
    exports: [
        APP_LOGGER,
        DB,
        AUTH_SERVICE,
        USER_PROVISIONING_SERVICE,
        WORKSPACE_MEMBERSHIP_SERVICE,
        SESSION_AUTH_SERVICE,
        RESOURCE_URL_GENERATOR,
        MCP_TOKEN_SERVICE,
        STORAGE_SERVICE,
        SessionAuthGuard,
        McpPatAuthGuard,
        SessionOrMcpPatGuard,
    ],
})
export class InfrastructureModule {}
