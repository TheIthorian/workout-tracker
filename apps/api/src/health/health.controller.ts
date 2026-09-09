import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import type { Logger } from '@app/logger';
import { CurrentUser, SessionAuthGuard, type CurrentUserContext } from '@app/nest-common';
import { loadEnv } from '../config/load-env.js';
import { APP_LOGGER, DB } from '../providers.js';

/** Liveness and readiness probes, plus two test-only routes. */
@Controller('health')
export class HealthController {
    constructor(
        @Inject(APP_LOGGER) private readonly logger: Logger,
        @Inject(DB) private readonly db: Db,
    ) {}

    /** Liveness: returns the literal text `ok` without touching the database. */
    @Get()
    @Header('content-type', 'text/plain')
    getHealth(): string {
        // Deliberately logged, and deliberately at debug: this is the cheapest route in the app to
        // prove that a log line emitted mid-request carries the correlation id the request-context
        // hook bound (see test/correlation-id-logging.e2e.spec.ts), but a liveness probe hits this
        // route every few seconds forever, so at info it would drown every other line in the log.
        this.logger.debug('Health check handled');

        return 'ok';
    }

    /**
     * Readiness, as distinct from the liveness check above: this one DOES touch the database, and
     * fails the request if it cannot.
     *
     * The two exist for different consumers and it matters which is pointed at what.
     * `healthcheckPath` in `railway.api.json` gates a DEPLOY - a new version that cannot reach its
     * database must not replace a working one, and because the connection pool is lazy the process
     * starts happily with a wrong `DATABASE_URL`, so nothing else would catch it. The container's
     * own `HEALTHCHECK` stays on the liveness route: restarting a process does not repair a
     * database that went away, it just adds churn to an existing outage.
     */
    @Get('ready')
    @Header('content-type', 'text/plain')
    async getReadiness(): Promise<string> {
        await this.db.execute(sql`select 1`);

        return 'ready';
    }

    /**
     * Test-only route that throws unconditionally, so `test/health.e2e.spec.ts` can exercise
     * `AppErrorFilter`'s terminal branch through the real HTTP stack rather than a filter unit
     * test alone. Falls back to a plain 404 outside `NODE_ENV=test`, so it is never a live route
     * that throws on purpose in production.
     */
    @Get('boom')
    getBoom(): never {
        if (loadEnv()['NODE_ENV'] !== 'test') {
            throw new EntityNotFoundError('Not found');
        }

        throw new Error('boom');
    }

    /**
     * Test-only route guarded by `SessionAuthGuard`, so `test/auth.e2e.spec.ts` can exercise the
     * guard through a real HTTP round trip (no cookie, a malformed cookie, a valid session)
     * independently of any real feature route. Falls back to a plain 404 outside `NODE_ENV=test`,
     * mirroring `getBoom` above, so this never becomes a live debug route.
     */
    @UseGuards(SessionAuthGuard)
    @Get('whoami')
    getWhoAmI(@CurrentUser() currentUser: CurrentUserContext): CurrentUserContext {
        if (loadEnv()['NODE_ENV'] !== 'test') {
            throw new EntityNotFoundError('Not found');
        }

        return currentUser;
    }
}
