import { AuthService, McpTokenService, UserProvisioningService, type AuthConfig } from '@app/auth';
import { createDb, type Db } from '@app/db';
import { createLogger, type Logger } from '@app/logger';
import { WorkspaceMembershipService } from '@app/services';
import {
    MCP_TOKEN_SERVICE,
    McpPatAuthGuard,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SESSION_AUTH_SERVICE,
    SessionAuthGuard,
    SessionOrMcpPatGuard,
} from '@app/nest-common';
import type { Provider } from '@nestjs/common';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

/** DI token for the application-wide {@link Logger}. */
export const APP_LOGGER = Symbol('APP_LOGGER');

/** DI token for the pooled {@link Db} handle. */
export const DB = Symbol('DB');

/** DI token for the configured {@link AuthService}. */
export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

/** DI token for the {@link UserProvisioningService} `AuthService` delegates account creation to. */
export const USER_PROVISIONING_SERVICE = Symbol('USER_PROVISIONING_SERVICE');

/**
 * DI token for the {@link WorkspaceMembershipService}. Global rather than per-slice: every
 * workspace-scoped service depends on it, and they must all authorise against the same instance.
 */
export const WORKSPACE_MEMBERSHIP_SERVICE = Symbol('WORKSPACE_MEMBERSHIP_SERVICE');

/**
 * Reads the Better Auth config Nest-side providers share, out of validated environment. Split out
 * so `USER_PROVISIONING_SERVICE` and `AUTH_SERVICE` build against the exact same values rather than
 * two copies of this env-reading logic drifting apart.
 */
function resolveAuthConfig(db: Db): Pick<AuthConfig, 'db' | 'secret' | 'baseUrl' | 'trustedOrigins' | 'secureCookies'> {
    const env = loadEnv();

    return {
        db,
        secret: String(env['AUTH_SECRET']),
        baseUrl: String(env['AUTH_BASE_URL']),
        trustedOrigins: String(env['AUTH_TRUSTED_ORIGINS'] ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        ...(env['AUTH_SECURE_COOKIES'] === undefined ? {} : { secureCookies: Boolean(env['AUTH_SECURE_COOKIES']) }),
    };
}

/**
 * Factory providers that construct this app's package-owned classes from validated environment.
 * This is the whole "apps compose packages" story for `apps/api` - every later slice's controller
 * depends on one of these tokens rather than constructing a package class itself.
 */
export const infrastructureProviders: Provider[] = [
    {
        provide: APP_LOGGER,
        useFactory: (): Logger => createLogger({ context: 'api', config: toLoggerConfig(loadEnv()) }),
    },
    {
        provide: DB,
        useFactory: (logger: Logger): Db => {
            const env = loadEnv();
            return createDb({ config: { connectionString: String(env['DATABASE_URL']) }, logger }).db;
        },
        inject: [APP_LOGGER],
    },
    {
        provide: USER_PROVISIONING_SERVICE,
        useFactory: (db: Db): UserProvisioningService => new UserProvisioningService(resolveAuthConfig(db)),
        inject: [DB],
    },
    {
        provide: AUTH_SERVICE,
        useFactory: (db: Db, logger: Logger, userProvisioning: UserProvisioningService): AuthService =>
            new AuthService({ config: resolveAuthConfig(db), userProvisioning, logger }),
        inject: [DB, APP_LOGGER, USER_PROVISIONING_SERVICE],
    },
    {
        provide: WORKSPACE_MEMBERSHIP_SERVICE,
        useFactory: (db: Db): WorkspaceMembershipService => new WorkspaceMembershipService({ db }),
        inject: [DB],
    },
    // Declared here rather than in a route slice: several modules attach links, and `apps/mcp`
    // builds the same generator from the same settings, so every client sees identical urls.
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
    // Aliases this app's AUTH_SERVICE onto the token `SessionAuthGuard` itself expects (see that
    // class's doc for why a plain constructor-typed AuthService param can't be resolved when the
    // guard is applied via `@UseGuards(SessionAuthGuard)`).
    {
        provide: SESSION_AUTH_SERVICE,
        useExisting: AUTH_SERVICE,
    },
    // The guard needs this reachable under `MCP_TOKEN_SERVICE`, for the same reflection reason
    // `SessionAuthGuard` needs `SESSION_AUTH_SERVICE`. `apps/mcp` builds no `McpTokenService` of
    // its own - it holds no database connection and validates tokens by calling this app instead.
    {
        provide: MCP_TOKEN_SERVICE,
        useFactory: (db: Db): McpTokenService => new McpTokenService({ db }),
        inject: [DB],
    },
    // Registered here (rather than left to Nest's per-controller `@UseGuards` auto-discovery) so
    // `SessionOrMcpPatGuard` - which takes both as constructor dependencies - resolves them from the
    // same global container it is itself resolved from, regardless of which feature module's
    // controller triggers its instantiation first.
    SessionAuthGuard,
    McpPatAuthGuard,
    SessionOrMcpPatGuard,
];
