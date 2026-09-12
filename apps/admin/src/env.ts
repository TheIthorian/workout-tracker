import Joi from 'joi';
import { ConfigurationError } from '@app/errors';
import { createEnvLoader } from '@app/env';
import type { StorageServiceConfig } from '@app/storage';
import { loadDotenv } from './load-dotenv.js';

// Populates `process.env` from this app's own `.env` before the schema below validates it, so a
// local file is enough to start the CLI. Never overrides a variable the environment already set,
// and is inert under vitest - see `loadDotenv`'s doc for why both of those matter.
loadDotenv();

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
    // Optional at the schema level for the same reason as AUTH_SECRET: only `seed-exercises`
    // needs object storage. `getStorageConfig` is what makes that one command refuse.
    S3_ENDPOINT: Joi.string().optional(),
    S3_REGION: Joi.string().default('us-east-1'),
    S3_BUCKET: Joi.string().optional(),
    S3_ACCESS_KEY_ID: Joi.string().optional(),
    S3_SECRET_ACCESS_KEY: Joi.string().optional(),
    S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
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

/**
 * The bucket `seed-exercises` uploads catalog images to. Must be the same bucket `apps/api`'s
 * `S3_BUCKET` names, or the URLs the API hands out point at objects that were never written.
 *
 * @throws ConfigurationError when the bucket or its credentials are missing.
 */
export function getStorageConfig(): StorageServiceConfig {
    const env = envLoader.loadEnv();
    const bucket = env['S3_BUCKET'];
    const accessKeyId = env['S3_ACCESS_KEY_ID'];
    const secretAccessKey = env['S3_SECRET_ACCESS_KEY'];

    if (typeof bucket !== 'string' || typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
        throw new ConfigurationError('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required.');
    }

    const endpoint = env['S3_ENDPOINT'];

    return {
        ...(typeof endpoint === 'string' && endpoint.length > 0 ? { endpoint } : {}),
        region: String(env['S3_REGION']),
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: Boolean(env['S3_FORCE_PATH_STYLE']),
    };
}
