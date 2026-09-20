import { randomUUID } from 'node:crypto';
import { AuthService, generateOpaqueToken, hashOpaqueToken, UserProvisioningService } from '@app/auth';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { createLogger, type Logger } from '@app/logger';
import { ACCESS_TOKEN_TTL_SECONDS, WorkspaceRole } from '@app/services';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { APP_LOGGER, AUTH_SERVICE, DB } from '../src/providers.js';

const { oauthAccessTokens, oauthGrants, workspaces, workspaceUsers } = schema;

/** The web-app origin every `webUrl` in a test response is built from. */
export const TEST_WEB_APP_BASE_URL = 'https://app.test';

/** The REST API origin every `resourceUrl` in a test response is built from. */
export const TEST_API_BASE_URL = 'https://api.test';

/** The MCP origin every `mcpUrl` in a test response is built from. */
export const TEST_MCP_BASE_URL = 'https://mcp.test';

/** The one client id every OAuth test uses; its host is the whole allowlist below. */
export const TEST_OAUTH_CLIENT_ID = 'https://client.test/oauth-client';

/** The one client id the test app vouches for. Everything else connects, marked unverified. */
export const TEST_VERIFIED_CLIENT_IDS = TEST_OAUTH_CLIENT_ID;

/** Origin the test app builds catalog image urls from. */
export const TEST_CATALOG_IMAGE_BASE_URL = 'https://cdn.test';

/** Test auth config. Never used to sign anything real - only a throwaway process shares it. */
const TEST_AUTH_CONFIG = {
    secret: 'test-secret-value-not-for-production-use',
    baseUrl: 'http://localhost:3000',
    trustedOrigins: [] as string[],
};

export type TestApp = {
    inject: NestFastifyApplication['inject'];
    /**
     * The underlying Nest DI container's own `get`, for a test that needs something no HTTP
     * response exposes - `test/route-guard-coverage.e2e.spec.ts` uses it to pull `ModulesContainer`
     * and walk the real, running app's registered controllers.
     */
    get: NestFastifyApplication['get'];
    /**
     * Origin of the really-listening server. Every suite here still drives the app through `inject`,
     * but `apps/mcp`'s harness boots this app for real (the MCP SDK's client transport speaks HTTP
     * over a socket) and needs a socket to point at.
     */
    baseUrl: string;
    db: Db;
    close(): Promise<void>;
};

/** One DI provider override, applied to the testing module via `TestingModuleBuilder.overrideProvider`. */
export type ProviderOverride = { provide: symbol | string | (new (...args: never[]) => unknown); useValue: unknown };

/**
 * Boots the real application module against a throwaway Postgres, overriding only the
 * infrastructure providers (plus whatever `overrides` supplies). Controllers, guards, pipes and the
 * exception filter are the production ones - a harness that stubs those tests the harness, not the
 * API.
 *
 * Never points at the developer's own database. `startTestDatabase` starts its own container and
 * applies the `drizzle/` migrations, so a test can truncate freely.
 *
 * @param logger overrides the `APP_LOGGER` provider (and the filter/auth-service logger built
 * alongside it) - only `test/correlation-id-logging.e2e.spec.ts` needs this, to capture log lines
 * emitted mid-request against a logger it can inspect.
 * @param overrides additional `overrideProvider(...).useValue(...)` calls, applied after the fixed
 * `DB`/`AUTH_SERVICE`/`APP_LOGGER` ones below. Use these to stub anything that would otherwise
 * cross a real network boundary - a DI override, not a monkey-patched global `fetch`.
 * @param db an already-started database to boot against instead of starting a new one.
 * `apps/mcp`'s harness passes its own here so the two apps share the ONE test-database container
 * rather than each starting its own; this app then must not stop a container it does not own, so
 * `close()` leaves that to whoever started it.
 */
export async function createTestApp({
    logger: loggerOverride,
    overrides = [],
    db: providedDb,
}: { logger?: Logger; overrides?: ProviderOverride[]; db?: Db } = {}): Promise<TestApp> {
    process.env['NODE_ENV'] ??= 'test';
    process.env['DATABASE_URL'] ??= 'postgres://placeholder/placeholder';
    process.env['AUTH_SECRET'] ??= TEST_AUTH_CONFIG.secret;
    process.env['AUTH_BASE_URL'] ??= TEST_AUTH_CONFIG.baseUrl;
    // The origins every response's links are built from. Only the link assertions read them, and
    // they assert against exactly these values. `??=` never overrides what a test already set.
    process.env['WEB_APP_BASE_URL'] ??= TEST_WEB_APP_BASE_URL;
    process.env['API_BASE_URL'] ??= TEST_API_BASE_URL;
    process.env['MCP_BASE_URL'] ??= TEST_MCP_BASE_URL;
    process.env['CATALOG_IMAGE_BASE_URL'] ??= TEST_CATALOG_IMAGE_BASE_URL;
    process.env['MCP_OAUTH_VERIFIED_CLIENT_IDS'] ??= TEST_VERIFIED_CLIENT_IDS;
    // Object storage is required configuration for this app, so the container refuses to boot
    // without it; no suite talks to storage, so placeholders are enough.
    process.env['S3_BUCKET'] ??= 'test-bucket';
    process.env['S3_ACCESS_KEY_ID'] ??= 'test-access-key';
    process.env['S3_SECRET_ACCESS_KEY'] ??= 'test-secret-key';

    // A caller-supplied db is already running and owned elsewhere: closing this app must not stop it.
    if (providedDb) {
        return await buildApp({ db: providedDb, stop: async (): Promise<void> => {}, loggerOverride, overrides });
    }

    const { db, stop } = await startTestDatabase();

    // Everything from here on runs inside try/catch: once the container is up, the caller has no
    // handle to stop it until this function returns, so anything that throws in between - a module
    // wiring error, a failed plugin registration, a flaky `ready()` - would orphan a Postgres
    // container with nothing left holding a reference to it. `startTestDatabase` guards its own
    // internals the same way, for the same reason.
    try {
        return await buildApp({ db, stop, loggerOverride, overrides });
    } catch (error) {
        await stop();
        throw error;
    }
}

async function buildApp({
    db,
    stop,
    loggerOverride,
    overrides,
}: {
    db: Db;
    stop: () => Promise<void>;
    loggerOverride?: Logger;
    overrides: ProviderOverride[];
}): Promise<TestApp> {
    const logger =
        loggerOverride ??
        createLogger({ context: 'api-test', config: { level: 'error', pretty: false, redact: true } });

    const authConfig = { db, ...TEST_AUTH_CONFIG };
    const authService = new AuthService({
        config: authConfig,
        userProvisioning: new UserProvisioningService(authConfig),
        logger,
    });

    let builder = Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DB)
        .useValue(db)
        .overrideProvider(AUTH_SERVICE)
        .useValue(authService)
        .overrideProvider(APP_LOGGER)
        .useValue(logger);

    for (const override of overrides) {
        builder = builder.overrideProvider(override.provide).useValue(override.useValue);
    }

    const moduleRef = await builder.compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    await configureApp(app, { logger });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Port 0: the OS picks a free port, so parallel suites never collide. Every suite here still
    // drives the app through `inject`, but listening costs nothing and gives `apps/mcp`'s harness a
    // real socket to point its own real, listening app at.
    await app.listen(0, '127.0.0.1');

    return {
        inject: app.inject.bind(app),
        get: app.get.bind(app),
        baseUrl: await app.getUrl(),
        db,
        close: async (): Promise<void> => {
            await app.close();
            await stop();
        },
    };
}

/**
 * Creates a user through `UserProvisioningService`, never by raw insert, so a test exercises the
 * same code path production does.
 */
export async function seedUser(
    db: Db,
    { email, displayName, password }: { email: string; displayName: string; password?: string },
): Promise<{ id: string }> {
    const userProvisioning = new UserProvisioningService({ db, ...TEST_AUTH_CONFIG });

    return userProvisioning.createUser({ email, name: displayName, ...(password === undefined ? {} : { password }) });
}

/** Inserts a workspace plus an owner membership. */
export async function seedWorkspace(
    db: Db,
    { name, ownerId }: { name: string; ownerId: string },
): Promise<{ id: string }> {
    const id = randomUUID();

    await db.insert(workspaces).values({ id, name });
    await db.insert(workspaceUsers).values({ userId: ownerId, workspaceId: id, role: WorkspaceRole.Owner });

    return { id };
}

/** Adds an existing user to an existing workspace. */
export async function seedMembership(
    db: Db,
    { workspaceId, userId, role = WorkspaceRole.Member }: { workspaceId: string; userId: string; role?: WorkspaceRole },
): Promise<void> {
    await db.insert(workspaceUsers).values({ workspaceId, userId, role });
}

/**
 * Issues an OAuth access token the way the token endpoint does - a grant row plus a token row
 * holding only the sha256 hash - so a test authenticates against exactly what `McpTokenService`
 * reads rather than against a shape hand-rolled here.
 */
export async function seedMcpToken(
    db: Db,
    {
        userId,
        workspaceId,
        clientId = TEST_OAUTH_CLIENT_ID,
    }: { userId: string; workspaceId: string; clientId?: string },
): Promise<string> {
    const token = generateOpaqueToken();

    const [grant] = await db
        .insert(oauthGrants)
        .values({ userId, clientId, workspaceId, scopes: ['mcp'] })
        .onConflictDoUpdate({
            target: [oauthGrants.userId, oauthGrants.clientId],
            set: { workspaceId, scopes: ['mcp'], revokedAt: null },
        })
        .returning({ id: oauthGrants.id });

    await db.insert(oauthAccessTokens).values({
        tokenHash: hashOpaqueToken(token),
        grantId: grant.id,
        clientId,
        userId,
        workspaceId,
        scopes: ['mcp'],
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    });

    return token;
}

/**
 * Posts to `/api/v1/auth/login` and returns the `set-cookie` header value for later requests -
 * every later route slice's test signs in this way rather than re-deriving a session cookie by
 * hand. Never logs the cookie value (it carries a live session token).
 */
export async function signIn(app: TestApp, params: { email: string; password: string }): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: params,
    });

    if (response.statusCode !== 200) {
        throw new Error(`signIn: expected 200, got ${response.statusCode}`);
    }

    const setCookie = response.headers['set-cookie'];
    if (!setCookie) {
        throw new Error('signIn: response had no set-cookie header');
    }

    return Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
}
