import cors from '@fastify/cors';
import { createLogger, type Logger } from '@app/logger';
import { AppErrorFilter, PinoNestLogger, RequestContextMiddleware, registerRequestLogging } from '@app/nest-common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

/**
 * Creates and configures the Nest Fastify application. Does not call `listen` - `main.ts` and
 * `test/harness.ts` share this so a test boots the exact same app a deployment does.
 */
export async function createApp(): Promise<NestFastifyApplication> {
    const env = loadEnv();
    const logger = createLogger({ context: 'mcp', config: toLoggerConfig(env) });

    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
        logger: new PinoNestLogger({ logger }),
    });

    await configureApp(app, { logger });

    return app;
}

/**
 * Registers the hooks and filter the running app needs. Shared with `test/harness.ts` so a test
 * boots the same app a deployment does.
 *
 * No global prefix, unlike `apps/api`: the MCP endpoint is `/mcp` and its RFC 9728 metadata sits at
 * `/.well-known/...`, whose location a client derives from the origin rather than from wherever
 * this app mounts its routes. No compression either - the transport writes an SSE stream, which
 * must not be buffered by a compressor.
 */
export async function configureApp(app: NestFastifyApplication, { logger }: { logger: Logger }): Promise<void> {
    // Every route here is credential-free in the browser's sense - there is no cookie, and the
    // access token is a header a page must already hold to send - so a wildcard origin gives a
    // hostile page nothing. Without it a browser-based MCP client cannot read the protected-resource
    // document, and cannot read the `WWW-Authenticate` challenge that tells it where to authorize.
    await app.register(cors, {
        origin: '*',
        credentials: false,
        exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
    });

    registerRequestContextHook(app);
    registerRequestLogging({ app: app.getHttpAdapter().getInstance(), logger });

    app.useGlobalFilters(new AppErrorFilter(logger));
}

/**
 * Attaches `RequestContextMiddleware` as a genuine Fastify `onRequest` hook, for the reason
 * `apps/api`'s identical helper documents: under `@nestjs/platform-fastify`, middleware registered
 * through `MiddlewareConsumer` runs via `@fastify/middie` and receives the raw Node `req`/`res`
 * rather than the Fastify request/reply pair the middleware calls methods on.
 */
export function registerRequestContextHook(app: NestFastifyApplication): void {
    const middleware = new RequestContextMiddleware();

    app.getHttpAdapter()
        .getInstance()
        .addHook('onRequest', (request, reply, done) => {
            middleware.use(request, reply, (error) => done(error as Error | undefined));
        });
}
