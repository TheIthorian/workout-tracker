import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@app/db';
import { TooManyRequestsError } from '@app/errors';

const { user, userLockout } = schema;

/**
 * Locks an account for 15 minutes after 5 failed sign-in attempts.
 *
 * Better Auth has no lockout of its own, and `rateLimit` alone cannot stand in for one: it is
 * IP+path keyed and only runs for requests that go through Better Auth's own HTTP router
 * (`auth.handler`), never for a direct `auth.api.*` call - which is exactly how `AuthService.login`
 * invokes sign-in. State lives in `user_lockout` (`packages/db/src/schema/lockout.ts`), keyed by
 * the Better Auth user id, in a repo-owned table rather than extra columns on `user`, because
 * Better Auth regenerates its own schema. There is no per-account enable flag: the absence of a row
 * is the clean slate.
 *
 * Registered by `AuthService` as top-level `hooks.before` / `hooks.after` rather than a plugin:
 * Better Auth calls these for EVERY endpoint, for both the HTTP router and a direct `auth.api.*`
 * call alike - unlike `rateLimit`, which only the router's `onRequest` applies. Each hook filters
 * to `/sign-in/email` itself.
 */
export const SIGN_IN_EMAIL_PATH = '/sign-in/email';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function extractEmail(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'email' in body) {
        const { email } = body as { email: unknown };
        return typeof email === 'string' ? email : undefined;
    }
    return undefined;
}

/**
 * Owns the per-account sign-in lockout counters in `user_lockout`, and produces the two Better
 * Auth middleware hooks (`before`/`after`) that read and update them around `/sign-in/email`.
 */
export class LockoutService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Blocks a sign-in attempt outright while the account is within its lockout window - before
     * Better Auth ever checks the password. Thrown as a typed `@app/errors` error, not returned: a
     * top-level `hooks.before` handler that returns a value is interpreted as a context patch, not
     * a response (see `runBeforeHooks` in `better-auth/dist/api/dispatch.mjs`); throwing is what
     * actually short-circuits the request. Any thrown error - typed or not - propagates the same
     * way (that function's `.catch` rethrows unconditionally), so `AuthService.login` catches this
     * `AppError` exactly as `signup()` already does, rather than a Better Auth `APIError`.
     */
    createBeforeHook(): ReturnType<typeof createAuthMiddleware> {
        return createAuthMiddleware(async (ctx) => {
            if (ctx.path !== SIGN_IN_EMAIL_PATH) {
                return;
            }

            const email = extractEmail(ctx.body);
            if (!email) {
                return;
            }

            const [row] = await this.db
                .select({ lockoutEnd: userLockout.lockoutEnd })
                .from(userLockout)
                .innerJoin(user, eq(user.id, userLockout.userId))
                .where(sql`lower(${user.email}) = lower(${email})`);

            if (row?.lockoutEnd && new Date(row.lockoutEnd).getTime() > Date.now()) {
                throw new TooManyRequestsError(
                    'Too many failed sign-in attempts',
                    'This account is temporarily locked. Try again in 15 minutes.',
                );
            }
        });
    }

    /**
     * A failed sign-in increments the failure count, and sets the lockout window once it reaches
     * {@link MAX_FAILED_ATTEMPTS}; a successful one clears the row. `ctx.context.returned` is Better
     * Auth's own way of exposing the endpoint's result to an after hook - an `APIError` for a
     * failed attempt (verified against `better-auth/dist/utils/plugin-helper.mjs`'s
     * `getEndpointResponse`, which reads the same field the same way), anything else for a
     * success.
     */
    createAfterHook(): ReturnType<typeof createAuthMiddleware> {
        return createAuthMiddleware(async (ctx) => {
            if (ctx.path !== SIGN_IN_EMAIL_PATH) {
                return;
            }

            const email = extractEmail(ctx.body);
            if (!email) {
                return;
            }

            const [found] = await this.db
                .select({ id: user.id })
                .from(user)
                .where(sql`lower(${user.email}) = lower(${email})`);

            if (!found) {
                return;
            }

            if (!isAPIError(ctx.context.returned)) {
                await this.db.delete(userLockout).where(eq(userLockout.userId, found.id));
                return;
            }

            const lockoutEnd = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();

            await this.db
                .insert(userLockout)
                .values({ userId: found.id, accessFailedCount: 1, lockoutEnd: null })
                .onConflictDoUpdate({
                    target: userLockout.userId,
                    set: {
                        accessFailedCount: sql`${userLockout.accessFailedCount} + 1`,
                        lockoutEnd: sql`case
                            when ${userLockout.accessFailedCount} + 1 >= ${MAX_FAILED_ATTEMPTS}
                            then ${lockoutEnd}::timestamptz
                            else ${userLockout.lockoutEnd}
                        end`,
                    },
                });
        });
    }
}
