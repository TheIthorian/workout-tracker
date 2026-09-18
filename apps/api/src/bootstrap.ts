import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { createLogger, type Logger } from '@app/logger';
import { AppErrorFilter, PinoNestLogger, RequestContextMiddleware, registerRequestLogging } from '@app/nest-common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

/** Multipart upload cap. Raise or lower it for whatever this app actually accepts. */
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/** Threshold in bytes above which `@fastify/compress` compresses a response body. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

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

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AppErrorFilter(logger));

    const corsOrigin = String(env['CORS_ORIGIN']);
    app.enableCors({
        origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
        // Session cookies require this whenever the origin is not the wildcard.
        credentials: corsOrigin !== '*',
    });
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
