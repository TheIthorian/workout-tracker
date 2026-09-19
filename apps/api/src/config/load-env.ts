import { PROBLEM_TYPE_BASE as PROBLEM_TYPE_BASE_DEFAULT } from '@app/errors';
import { createEnvLoader } from '@app/env';
import { LOG_LEVELS } from '@app/logger';
import Joi from 'joi';
import { loadDotenv } from './load-dotenv.js';

// Populates `process.env` from the monorepo root's `.env` before the schema below validates it, so
// a local file is enough to start the server. Never overrides a variable the environment already
// set, and is inert under vitest - see `loadDotenv`'s doc for why both of those matter.
loadDotenv();

/**
 * `apps/api`'s environment. Every secret is *required*: an API booted without an auth secret should
 * fail at startup rather than issue unverifiable sessions.
 */
const schema = Joi.object({
    PORT: Joi.number().default(3000),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    // Set by Railway to the commit the running image was built from; empty in any other environment.
    RAILWAY_GIT_COMMIT_SHA: Joi.string().allow('').default(''),
    LOG_LEVEL: Joi.string()
        .valid(...LOG_LEVELS)
        .default('info'),
    LOG_PRETTY: Joi.boolean().default(false),
    LOG_REDACT: Joi.boolean().default(true),
    DATABASE_URL: Joi.string().uri().required(),
    // Applies the committed `packages/db/drizzle` migrations during boot, before the server
    // listens. On by default so a deployment needs no separate release step and no operator with
    // a psql session; set it to false where a platform runs migrations as its own job.
    DB_MIGRATE_ON_STARTUP: Joi.boolean().default(true),
    // Publishes content/exercises into the catalog once the server is listening, so catalog content
    // ships with a release instead of needing an operator (and a publicly reachable database).
    // Optional, defaults to true; the run is idempotent, so a boot that changes nothing is cheap.
    CATALOG_SEED_ON_STARTUP: Joi.boolean().default(true),
    // Where that content lives. Optional: `content/exercises` is found automatically both in the
    // image and in a checkout. Set it only to seed from somewhere else; relative paths resolve
    // against the working directory.
    CATALOG_CONTENT_DIR: Joi.string().allow('').default(''),
    AUTH_SECRET: Joi.string().required(),
    AUTH_BASE_URL: Joi.string().uri().required(),
    AUTH_TRUSTED_ORIGINS: Joi.string().optional(),
    AUTH_SECURE_COOKIES: Joi.boolean().optional(),
    CORS_ORIGIN: Joi.string().default('*'),
    // The two origins `ResourceUrlGenerator` builds every response's `webUrl` and `resourceUrl`
    // from. Required rather than defaulted: a wrong origin produces links that look right and 404
    // for whoever follows them. `apps/mcp` requires the same pair, so both processes hand out
    // identical links.
    WEB_APP_BASE_URL: Joi.string().uri().required(),
    API_BASE_URL: Joi.string().uri().required(),
    // Origin of `apps/mcp`, the separate process serving `/mcp/{token}`. Required for the same
    // reason as the pair above, and more urgently: it is the origin of the `mcpUrl` handed back
    // when a personal access token is created, and this process serves no `/mcp` route to fall back
    // on, so a missing value cannot degrade into a merely-wrong-looking link.
    MCP_BASE_URL: Joi.string().uri().required(),
    // Origin catalog image URLs are built from: `${CATALOG_IMAGE_BASE_URL}/${storage_key}`. In
    // production a CDN in front of the bucket; locally MinIO's anonymous-read `catalog/` prefix.
    // Required: a missing value produces image URLs that look right and 404.
    CATALOG_IMAGE_BASE_URL: Joi.string().uri().required(),
    // Base URI every problem body's `type` is built from. Set it to this deployment's own origin.
    PROBLEM_TYPE_BASE: Joi.string().default(PROBLEM_TYPE_BASE_DEFAULT),
    // Optional: leaving the key blank is a supported "LLM disabled" deployment, not a
    // misconfiguration to fail boot over. A provider is only constructed when the key is non-blank.
    //
    // Named LLM_* rather than OPENAI_* deliberately. The endpoint defaults to OpenRouter, so
    // OPENAI_ would misdescribe it, and more importantly the OpenAI SDK reads
    // `process.env.OPENAI_API_KEY` ITSELF when constructed with an undefined apiKey - naming ours
    // OPENAI_API_KEY would let that silent fallback mask a wiring bug.
    LLM_API_KEY: Joi.string().allow('').default(''),
    LLM_BASE_URL: Joi.string().uri().default('https://openrouter.ai/api/v1'),
    LLM_MODEL: Joi.string().default('openai/gpt-4o-mini'),
    // S3/MinIO object storage. The bucket and its credentials are required: exercise guide images
    // are uploaded to and served from this bucket, so a deployment that exposes those routes with
    // storage silently disabled would fail on a user's first upload rather than at boot.
    // ENDPOINT/REGION/FORCE_PATH_STYLE have real, safe defaults (unset endpoint means real AWS S3;
    // path-style addressing, which MinIO needs and AWS tolerates).
    S3_ENDPOINT: Joi.string().optional(),
    S3_REGION: Joi.string().default('us-east-1'),
    S3_BUCKET: Joi.string().required(),
    S3_ACCESS_KEY_ID: Joi.string().required(),
    S3_SECRET_ACCESS_KEY: Joi.string().required(),
    S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
});

export const { loadEnv, toLoggerConfig, resetEnvCache } = createEnvLoader({ schema });
