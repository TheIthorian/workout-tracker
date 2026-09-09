import Joi from 'joi';
import { ConfigurationError } from '@app/errors';
import { createEnvLoader } from '@app/env';

/**
 * This CLI reads a handful of environment variables, so its schema is tiny compared to a full app's
 * - but it still goes through `@app/env` rather than `process.env` directly, per the repo rule that
 * only apps read the environment, and only through the shared loader.
 */
const schema = Joi.object({
    DATABASE_URL: Joi.string()
        .uri({ scheme: ['postgres', 'postgresql'] })
        .required(),
    // Optional at the schema level, NOT required: only `create-user` needs it, and this file
    // validates the whole environment together, so marking it `.required()` here would refuse to
    // run the read-only commands too. `getAuthSecret` below is what makes that one command refuse.
    AUTH_SECRET: Joi.string().optional(),
    AUTH_BASE_URL: Joi.string().uri().optional(),
});

const envLoader = createEnvLoader({ schema });

/** Re-exported so tests can force a re-read after mutating `process.env` mid-suite. */
export const resetEnvCache = envLoader.resetEnvCache;

/**
 * @throws ConfigurationError when `DATABASE_URL` is missing or not a postgres connection string.
 */
export function getDatabaseUrl(): string {
    const env = envLoader.loadEnv();
    const databaseUrl = env['DATABASE_URL'];

    if (typeof databaseUrl !== 'string') {
        throw new ConfigurationError('DATABASE_URL is missing or invalid.');
    }

    return databaseUrl;
}

/**
 * The Better Auth configuration `create-user` needs to hash a password the running API will later
 * accept. The values must match `apps/api`'s, or the credential this CLI writes verifies against a
 * different secret than the one sign-in checks.
 *
 * @throws ConfigurationError when `AUTH_SECRET` is missing.
 */
export function getAuthConfig(): { secret: string; baseUrl: string } {
    const env = envLoader.loadEnv();
    const secret = env['AUTH_SECRET'];

    if (typeof secret !== 'string' || secret.length === 0) {
        throw new ConfigurationError('AUTH_SECRET is missing.');
    }

    const baseUrl = env['AUTH_BASE_URL'];

    return { secret, baseUrl: typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : 'http://localhost:3000' };
}
