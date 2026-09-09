import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import type { BetterAuthOptions } from 'better-auth';
import { SIGN_IN_EMAIL_PATH } from './lockout.service.js';

const { account, session, user, verification } = schema;

/** The four Better Auth tables this package's Drizzle adapter is bound to. */
export const AUTH_SCHEMA = { user, session, account, verification };

/**
 * Everything Better Auth needs to run. `secret` and `baseUrl` are constructor arguments, never
 * read from `process.env` - the app that owns the environment owns validating it.
 */
export type AuthConfig = {
    db: Db;
    secret: string;
    baseUrl: string;
    trustedOrigins?: string[];
    /**
     * Forces the session cookie's `Secure` attribute, overriding Better Auth's own inference from
     * `baseUrl`'s scheme. Behind a TLS-terminating proxy `baseUrl` can legitimately be an internal
     * `http://` address even though the browser-facing connection is HTTPS, which would otherwise
     * silently drop `Secure`. Set it to `true` in any such deployment.
     */
    secureCookies?: boolean;
};

/**
 * The options object handed to both `betterAuth()` itself (`AuthService`) and to every standalone
 * `drizzleAdapter(...)` instance this package builds (`UserProvisioningService`). Kept as one
 * function so the two never drift - a standalone adapter built with different options would
 * compute field defaults (notably the id) differently than the real server does.
 */
export function buildAuthOptions(
    config: Pick<AuthConfig, 'secret' | 'baseUrl' | 'trustedOrigins' | 'secureCookies'>,
): BetterAuthOptions {
    return {
        secret: config.secret,
        baseURL: config.baseUrl,
        trustedOrigins: config.trustedOrigins,
        emailAndPassword: { enabled: true },
        // Better Auth's router applies `rateLimit` to every request that passes through it. That
        // covers a mounted `auth.handler`, but NOT a direct `auth.api.*` call - `onRequestRateLimit`
        // is only invoked from the router's `onRequest`, never from `dispatchAuthEndpoint`, which
        // is the path `AuthService.login` takes. Per-account lockout (`lockout.service.ts`) is what
        // covers that path; this is the second layer.
        //
        // `enabled: true` because Better Auth's own default reads `NODE_ENV` internally, and this
        // package should not depend on a dependency's environment sniffing for a security property.
        // Storage stays the default `"memory"`: `storage: "database"` is the only setting that adds
        // a `rateLimit` table, and the authored schema is exactly the four tables in `AUTH_SCHEMA`.
        rateLimit: {
            enabled: true,
            customRules: {
                [SIGN_IN_EMAIL_PATH]: { window: 15 * 60, max: 5 },
            },
        },
        advanced: {
            database: {
                // Passing the literal string "uuid" here does NOT mean client-side generation for a
                // Postgres adapter - it makes Better Auth omit `id` from the INSERT and rely on the
                // column's own DEFAULT. `user.id` has no such default, so that setting fails every
                // insert. A custom `generateId` FUNCTION takes a different path and always
                // generates in JS, which is what this schema needs.
                generateId: () => randomUUID(),
            },
            useSecureCookies: config.secureCookies,
        },
    };
}
