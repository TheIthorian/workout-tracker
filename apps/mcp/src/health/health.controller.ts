import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { Logger } from '@app/logger';
import { loadEnv } from '../config/load-env.js';
import { APP_LOGGER } from '../providers.js';

/**
 * Liveness and readiness for `apps/mcp`.
 *
 * No global prefix here, unlike `apps/api`, so these are `/health` and `/health/ready` - see
 * `bootstrap.ts` for why this app mounts no prefix.
 */
@Controller('health')
export class HealthController {
    constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

    /** Liveness: is this process up. No dependencies, so it cannot fail for someone else's reason. */
    @Get()
    @Header('content-type', 'text/plain')
    getHealth(): string {
        // Debug, not info: a liveness probe hits this every few seconds forever, and at info it
        // would drown every other line in the log.
        this.logger.debug('Health check handled');

        return 'ok';
    }

    /**
     * Readiness: can this process do its job. It cannot without `apps/api` - every one of its 22
     * tools is an HTTP call there, and it resolves the caller's workspace over the same connection
     * - so a build that cannot reach the API is not ready to serve, however healthy its own
     * process is.
     *
     * Diagnostic only - neither Railway's `healthcheckPath` nor the container's own `HEALTHCHECK`
     * points here. Both stay on the liveness route above: restarting this process does not repair
     * the API, and gating a deploy on another service's health deadlocks the pair, since `api` and
     * `mcp` deploy together on a push and each restart would fail the other's probe. A malformed
     * `API_INTERNAL_BASE_URL` is caught by `load-env.ts`'s URI validation at boot instead.
     */
    @Get('ready')
    @Header('content-type', 'text/plain')
    async getReadiness(): Promise<string> {
        const baseUrl = String(loadEnv()['API_INTERNAL_BASE_URL']).replace(/\/+$/, '');
        const response = await fetch(`${baseUrl}/api/health`);

        if (!response.ok) throw new Error(`apps/api at ${baseUrl} answered ${response.status}`);

        return 'ready';
    }
}
