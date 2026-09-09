import { createEnvLoader } from '@app/env';
import { LOG_LEVELS } from '@app/logger';
import Joi from 'joi';
import { loadDotenv } from './load-dotenv.js';
import { PROBLEM_TYPE_BASE as PROBLEM_TYPE_BASE_DEFAULT } from '@app/errors';

// Populates `process.env` from this app's `.env` before the schema below validates it - see
// `loadDotenv`'s doc for why it never overrides an already-set variable and is inert under vitest.
loadDotenv();

/**
 * `apps/mcp`'s environment. Deliberately much smaller than `apps/api`'s: every tool, and session
 * resolution itself (`mcp.controller.ts`'s call to `GET /me/mcp-session`), reaches `apps/api` over
 * HTTP rather than this process holding a database connection, so there is no `DATABASE_URL`, no
 * Better Auth secret, no cookie configuration and no object-storage or LLM credentials at all.
 * Holding none of them keeps a compromised MCP deployment unable to forge a session or reach
 * infrastructure `apps/api` alone should own.
 */
const schema = Joi.object({
    // A different default from `apps/api`'s 3000 so both can run locally without a port clash.
    PORT: Joi.number().default(3100),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    LOG_LEVEL: Joi.string()
        .valid(...LOG_LEVELS)
        .default('info'),
    LOG_PRETTY: Joi.boolean().default(false),
    LOG_REDACT: Joi.boolean().default(true),
    // The web app's origin, used to build the `webUrl` every tool result carries and quoted in the
    // server instructions the client reads after `initialize`. Required rather than defaulted: a
    // wrong origin produces links that look right and 404 for the user, which is worse than failing
    // at boot.
    WEB_APP_BASE_URL: Joi.string().uri().required(),
    // Origin of the REST API, used to build the `resourceUrl` every result carries beside `webUrl`.
    // Configured rather than derived from the current request: this process serves a different
    // origin from the API it points at. Required for the same reason WEB_APP_BASE_URL is.
    API_BASE_URL: Joi.string().uri().required(),
    // The origin this process actually sends its own REST calls to - a separate concern from
    // API_BASE_URL above, which is the public origin baked into every `resourceUrl` link for an end
    // user's browser to follow. The two coincide in most deployments (hence the default below), but
    // not in every one: behind a service mesh or sidecar proxy, or in this app's own test harness
    // (`test/harness.ts`, which points this at the real `apps/api` instance it boots on an ephemeral
    // port while `API_BASE_URL` stays a placeholder so `resourceUrl` assertions keep pinning a stable
    // value), the address this process dials is not the address a browser would use. Defaulting to
    // `API_BASE_URL` means a deployment that only ever configured one address keeps working unchanged.
    API_INTERNAL_BASE_URL: Joi.string().uri().default(Joi.ref('API_BASE_URL')),
    // This server's own public origin. Used by `mcp.controller.ts` only indirectly (it builds
    // `ApiClient` from `API_INTERNAL_BASE_URL`, not this value), but required in the same shape as
    // `apps/api`'s so both processes construct one identical `ResourceUrlGenerator`, and so this
    // origin is declared where it is served from - `apps/api` builds the `mcpUrl` it points at.
    MCP_BASE_URL: Joi.string().uri().required(),
    // Base URI every problem body's `type` is built from. MCP tools return problem bodies to the
    // client as the tool result, so this must match `apps/api`'s value - a client matching on the
    // `type` URI would otherwise see two different identifiers for the same error.
    PROBLEM_TYPE_BASE: Joi.string().default(PROBLEM_TYPE_BASE_DEFAULT),
});

export const { loadEnv, toLoggerConfig, resetEnvCache } = createEnvLoader({ schema });
