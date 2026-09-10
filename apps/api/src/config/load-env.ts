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
    LOG_LEVEL: Joi.string()
        .valid(...LOG_LEVELS)
        .default('info'),
    LOG_PRETTY: Joi.boolean().default(false),
    LOG_REDACT: Joi.boolean().default(true),
    DATABASE_URL: Joi.string().uri().required(),
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
