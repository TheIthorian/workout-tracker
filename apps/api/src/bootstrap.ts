import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import type { FastifyCorsOptions } from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createLogger, type Logger } from '@app/logger';
import { AppErrorFilter, PinoNestLogger, RequestContextMiddleware, registerRequestLogging } from '@app/nest-common';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

/** Multipart upload cap. Raise or lower it for whatever this app actually accepts. */
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/** Threshold in bytes above which `@fastify/compress` compresses a response body. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Routes any origin may read. OAuth discovery is meant to be world-readable, and a browser-based
 * MCP client reaches the token endpoints from its own origin; restricting these to the SPA's origin
 * makes such a client fail discovery and fall back to guessing a registration endpoint.
 *
 * Safe because all three are credential-free: none reads a cookie, so a `*` origin hands a hostile
 * page nothing it could not have fetched from its own server. Every cookie-authenticated route -
 * the consent endpoints included - stays on the SPA-only policy below.
 */
const PUBLIC_CORS_PATHS = new Set([
    '/.well-known/oauth-authorization-server',
    '/api/v1/oauth/token',
    '/api/v1/oauth/revoke',
]);

/**
 * Creates and configures the Nest Fastify application. Does not call `listen` - `main.ts` and
 * `test/harness.ts` share this so a test boots the exact same app a deployment does.
 */
export async function createApp(): Promise<NestFastifyApplication> {
    // Validate before anything else: a bad environment should be one clear error, not a stack
    // trace from whichever subsystem happened to read it first.
    const env = loadEnv();
    const logger = createLogger({ context: 'api', config: toLoggerConfig(env) });
    const commitSha = String(env['RAILWAY_GIT_COMMIT_SHA']);

    logger.info({ commitSha: commitSha === '' ? 'unknown' : commitSha }, 'API starting');

    // trustProxy: the service always runs behind a proxy in production, so without it every
    // request reports the proxy's address and IP-keyed rate limits bucket all clients together.
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
        logger: new PinoNestLogger({ logger }),
    });

    await configureApp(app, { logger });

    return app;
}

/**
 * Registers every plugin, hook, filter and CORS policy the running app needs, in the order
 * production requires. `createApp` and `test/harness.ts` both call this so a test boots the exact
 * same app a deployment does, rather than a hand-rolled reimplementation that can silently drift -
 * e.g. by omitting `@fastify/compress`, which wraps `reply.send` and is therefore on the same call
 * path `AuthController`'s `@Res({ passthrough: false })` responses and `writeHandlerResponse`'s
 * manual `set-cookie` array depend on.
 *
 * @param logger the logger passed to the global exception filter. `createApp` builds one from
 * `loadEnv`; the harness builds its own (or accepts an override) so a test can inspect log lines
 * without going through environment-derived logger config.
 */
export async function configureApp(app: NestFastifyApplication, { logger }: { logger: Logger }): Promise<void> {
    const env = loadEnv();

    await app.register(compress, {
        threshold: COMPRESSION_THRESHOLD_BYTES,
        encodings: ['br', 'gzip', 'deflate'],
    });

    await app.register(cookie);

    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

    registerRequestContextHook(app);
    registerRequestLogging({ app: app.getHttpAdapter().getInstance(), logger });

    // RFC 8414 §3 derives the metadata document's location from the issuer identifier, which is
    // this deployment's origin - a client looks for it at `/.well-known/...` and nowhere else, so
    // that one route cannot sit behind the application's prefix.
    app.setGlobalPrefix('api', {
        exclude: [{ path: '.well-known/oauth-authorization-server', method: RequestMethod.GET }],
    });
    app.useGlobalFilters(new AppErrorFilter(logger));

    const corsOrigin = String(env['CORS_ORIGIN']);
    const appPolicy: FastifyCorsOptions = {
        origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
        // Session cookies require this whenever the origin is not the wildcard.
        credentials: corsOrigin !== '*',
    };

    // A delegator rather than one static policy: the discovery and token routes need a wider origin
    // than the rest of the API, and `@fastify/cors` decides per request when given one.
    app.enableCors({
        delegator: (request: FastifyRequest, callback: (error: Error | null, options: FastifyCorsOptions) => void) => {
            callback(null, isPublicCorsPath(request.url) ? { origin: '*', credentials: false } : appPolicy);
        },
    });
}

/** Whether a request path is one of {@link PUBLIC_CORS_PATHS}, ignoring any query string. */
function isPublicCorsPath(url: string): boolean {
    const queryStart = url.indexOf('?');

    return PUBLIC_CORS_PATHS.has(queryStart === -1 ? url : url.slice(0, queryStart));
}

/**
 * Attaches `RequestContextMiddleware` as a genuine Fastify `onRequest` hook, exported so
 * `test/harness.ts` can register the exact same hook on its own app instance.
 *
 * NOT registered via `NestModule.configure()` / `MiddlewareConsumer`: under
 * `@nestjs/platform-fastify`, that path runs through `@fastify/middie`, which invokes the
 * middleware with the raw Node `req`/`res` (no `.header()`) rather than the
 * `FastifyRequest`/`FastifyReply` pair the middleware is typed against and calls methods on -
 * confirmed by a `reply.header is not a function` failure from exactly that path. Fastify's own
 * `onRequest` hook receives the real wrapped request/reply, which is what the middleware needs.
 */
export function registerRequestContextHook(app: NestFastifyApplication): void {
    const middleware = new RequestContextMiddleware();

    app.getHttpAdapter()
        .getInstance()
        .addHook('onRequest', (request, reply, done) => {
            middleware.use(request, reply, (error) => done(error as Error | undefined));
        });
}
