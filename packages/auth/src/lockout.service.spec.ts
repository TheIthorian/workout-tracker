import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfig } from './auth-options.js';
import { AuthService } from './auth.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

const { user, userLockout } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let config: AuthConfig;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    config = { db, secret: 'test-only-secret-does-not-guard-anything-real', baseUrl: 'http://localhost:3000' };
});

afterAll(async () => {
    await database?.stop();
});

function buildAuthService(): AuthService {
    return new AuthService({ config, userProvisioning: new UserProvisioningService(config) });
}

/**
 * Lockout state lives in `user_lockout`, keyed by the Better Auth user id, so a clean account
 * has NO row rather than a row of zeroes. Returns undefined for that case, and every assertion
 * below is written against that.
 */
async function selectLockout(email: string) {
    const [row] = await db
        .select({
            accessFailedCount: userLockout.accessFailedCount,
            lockoutEnd: userLockout.lockoutEnd,
        })
        .from(userLockout)
        .innerJoin(user, eq(user.id, userLockout.userId))
        .where(sql`lower(${user.email}) = lower(${email})`);
    return row;
}

describe('sign-in lockout', () => {
    it('locks the account after 5 failed attempts, rejecting even the correct password with 429', async () => {
        const authService = buildAuthService();
        const email = `lockout-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        for (let attempt = 0; attempt < 5; attempt++) {
            const response = await authService.login({ email, password: 'wrong-password' });
            expect(response.status).toBe(401);
        }

        const lockedRow = await selectLockout(email);
        expect(lockedRow.accessFailedCount).toBe(5);
        expect(lockedRow.lockoutEnd).not.toBeNull();

        const stillLocked = await authService.login({ email, password: 'correct-horse' });
        expect(stillLocked.status).toBe(429);
    });

    it('resets AccessFailedCount to 0 after a successful sign-in', async () => {
        const authService = buildAuthService();
        const email = `lockout-reset-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        await authService.login({ email, password: 'wrong-password' });
        await authService.login({ email, password: 'wrong-password' });

        const midway = await selectLockout(email);
        expect(midway.accessFailedCount).toBe(2);

        const success = await authService.login({ email, password: 'correct-horse' });
        expect(success.status).toBe(200);

        const afterSuccess = await selectLockout(email);
        expect(afterSuccess).toBeUndefined();
    });

    it('counts every one of five concurrent failed attempts', async () => {
        const authService = buildAuthService();
        const email = `lockout-concurrent-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        await Promise.all(Array.from({ length: 5 }, () => authService.login({ email, password: 'wrong-password' })));

        // The previous implementation read AccessFailedCount and wrote back count+1 in two
        // statements, so concurrent failures overwrote each other and undercounted. The single
        // INSERT ... ON CONFLICT DO UPDATE makes each increment atomic.
        const row = await selectLockout(email);
        expect(row.accessFailedCount).toBe(5);
        expect(row.lockoutEnd).not.toBeNull();
    });

    it('does not lock an account that has fewer than 5 failed attempts', async () => {
        const authService = buildAuthService();
        const email = `lockout-under-threshold-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        for (let attempt = 0; attempt < 4; attempt++) {
            await authService.login({ email, password: 'wrong-password' });
        }

        const response = await authService.login({ email, password: 'correct-horse' });
        expect(response.status).toBe(200);
    });
});
