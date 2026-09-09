import { randomUUID } from 'node:crypto';
import { UserProvisioningService } from '@app/auth';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { ItemsService, McpAccessTokensService, WorkspaceMembershipService, WorkspaceRole } from '@app/services';
import { createLogger, type Logger } from '@app/logger';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { APP_LOGGER } from '../src/providers.js';
// Reaches into a sibling app's test-only code, not a real cross-app dependency: `apps/mcp` has no
// database of its own to exercise, so its e2e tests stand up a real `apps/api` in-process (via this
// harness) to call over HTTP, the same way `apps/mcp`'s own production process does. Deliberately
// not a declared `package.json` dependency - `test/` is never published or built for deployment, and
// both apps live in this one pnpm workspace, so the relative path always resolves.
import { createTestApp as createApiTestApp } from '../../api/test/harness.js';

const { workspaces, workspaceUsers } = schema;

/** Test auth config. Never used to sign anything real - only Postgres and a throwaway process share it. */
const TEST_AUTH_CONFIG = {
    secret: 'test-secret-value-not-for-production-use',
    baseUrl: 'http://localhost:3100',
    trustedOrigins: [] as string[],
};

/** The web-app origin every `webUrl` in a test result is built from. */
export const TEST_WEB_APP_BASE_URL = 'https://app.test';

/** The REST API origin every `resourceUrl` in a test result is built from. */
export const TEST_API_BASE_URL = 'https://api.test';

/** This server's own origin. Nothing here builds an `mcpUrl`; the setting is required all the same. */
export const TEST_MCP_BASE_URL = 'https://mcp.test';

export type TestApp = {
    inject: NestFastifyApplication['inject'];
    /** Origin of the really-listening server, for the MCP SDK's own HTTP client transport. */
    baseUrl: string;
    db: Db;
    close(): Promise<void>;
};

/**
 * Boots the real application module against a throwaway Postgres, overriding only the `APP_LOGGER`
 * provider. The controller, the transport and the exception filter are the production ones - a
 * harness that stubs those tests the harness, not the server. `apps/mcp` itself holds no database
 * connection: the Postgres this starts backs the real `apps/api` instance booted below, which every
 * seed helper and the app's own session resolution and tool calls reach through.
 *
 * Also boots the real `apps/api` against the SAME Postgres (never a second container) and listens it
 * on its own ephemeral port: every tool, and the connection-time session lookup itself, reach their
 * data through that app's routes, guards and exception filter, and a harness that stubbed the API
 * instead would test the harness rather than the thing under test.
 *
 * Unlike `apps/api`'s own harness this one really listens on a port: the MCP SDK's client transport
 * speaks HTTP over a socket, and a test that skipped it (driving the tools by hand through
 * `app.inject`) would prove nothing about the transport mount, which is the part most likely to be
 * wrong.
 */
export async function createTestApp(): Promise<TestApp> {
    process.env['NODE_ENV'] ??= 'test';
    process.env['WEB_APP_BASE_URL'] ??= TEST_WEB_APP_BASE_URL;
    // Deliberately NOT the API app's real listening origin (set below): this is the value every
    // `resourceUrl` in a tool result is built from, and pinning it to a stable placeholder is what
    // lets link assertions assert on a fixed string rather than an ephemeral port.
    process.env['API_BASE_URL'] ??= TEST_API_BASE_URL;
    process.env['MCP_BASE_URL'] ??= TEST_MCP_BASE_URL;

    const { db, stop } = await startTestDatabase();

    // Everything from here runs inside try/catch: once the container is up, the caller has no handle
    // to stop it until this function returns, so a wiring error in between would orphan it. The API
    // app is booted inside this same guard, and closed on its own if the MCP app then fails to build,
    // so neither a failed API boot nor a failed MCP boot ever leaks the shared container.
    try {
        const api = await createApiTestApp({ db });

        // The address this app's own requests dial, as opposed to `API_BASE_URL` above, which stays
        // the placeholder `resourceUrl` assertions pin against. Set here, after `apps/api` is
        // actually listening, rather than defaulted alongside the other variables above: `loadEnv`
        // takes one validated snapshot of `process.env`, so it must see the real ephemeral port
        // before `buildApp` below first triggers that snapshot.
        process.env['API_INTERNAL_BASE_URL'] = api.baseUrl;

        try {
            return await buildApp({ db, stop, apiClose: api.close });
        } catch (error) {
            await api.close();
            throw error;
        }
    } catch (error) {
        await stop();
        throw error;
    }
}

/** Creates a Better Auth user through the real service, credential and all. */
export async function seedUser(
    db: Db,
    { email, displayName }: { email: string; displayName: string },
): Promise<{ id: string }> {
    const userProvisioning = new UserProvisioningService({ db, ...TEST_AUTH_CONFIG });

    return userProvisioning.createUser({ email, name: displayName });
}

/** Inserts a workspace plus the owner membership for `ownerId`. */
export async function seedWorkspace(
    db: Db,
    { name, ownerId }: { name: string; ownerId: string },
): Promise<{ id: string }> {
    const id = randomUUID();

    await db.insert(workspaces).values({ id, name });
    await db.insert(workspaceUsers).values({ userId: ownerId, workspaceId: id, role: WorkspaceRole.Owner });

    return { id };
}

/**
 * Issues a real personal access token through `McpAccessTokensService`, so a test authenticates the
 * same way a client does - against a stored sha256 hash - rather than against a row hand-inserted
 * with a shape the service might not produce.
 */
export async function seedMcpToken(
    db: Db,
    { userId, workspaceId }: { userId: string; workspaceId: string },
): Promise<string> {
    const service = new McpAccessTokensService({ db, membership: new WorkspaceMembershipService({ db }) });
    const { token } = await service.createToken({ userId, workspaceId, name: 'test' });

    return token;
}

/**
 * Creates an item through the real service, so a read-tool test has something to read that was
 * written the way production writes it.
 */
export async function seedItem(
    db: Db,
    { userId, workspaceId, name }: { userId: string; workspaceId: string; name: string },
): Promise<{ id: string }> {
    const service = new ItemsService({ db, membership: new WorkspaceMembershipService({ db }) });

    return service.create({ userId, workspaceId, name });
}

/** An MCP client connected through the real HTTP transport to `/mcp/{token}`. */
export async function connectedClient(app: TestApp, { token }: { token: string }): Promise<Client> {
    const client = new Client({ name: 'mcp-e2e-test', version: '0.0.1' });

    await client.connect(new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/mcp/${token}`)));

    return client;
}

/** Parses the JSON body out of a tool result's single text content block. */
export function toolResultBody(result: { content: unknown }): unknown {
    const [block] = result.content as { type: string; text: string }[];

    return JSON.parse(block.text);
}

async function buildApp({
    db,
    stop,
    apiClose,
}: {
    db: Db;
    stop: () => Promise<void>;
    /** Closes the `apps/api` app booted alongside this one. Called before `stop` tears down the db. */
    apiClose: () => Promise<void>;
}): Promise<TestApp> {
    const logger: Logger = createLogger({
        context: 'mcp-test',
        config: { level: 'fatal', pretty: false, redact: true },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(APP_LOGGER)
        .useValue(logger)
        .compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    await configureApp(app, { logger });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Port 0: the OS picks a free port, so parallel suites never collide.
    await app.listen(0, '127.0.0.1');

    return {
        inject: app.inject.bind(app),
        baseUrl: await app.getUrl(),
        db,
        close: async (): Promise<void> => {
            await app.close();
            await apiClose();
            await stop();
        },
    };
}
