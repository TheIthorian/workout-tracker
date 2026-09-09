import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfig } from './auth-options.js';
import { AuthService } from './auth.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

const { user } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let config: AuthConfig;
let userProvisioning: UserProvisioningService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    config = {
        db,
        secret: 'test-only-secret-does-not-guard-anything-real',
        baseUrl: 'http://localhost:3000',
    };
    userProvisioning = new UserProvisioningService(config);
});

afterAll(async () => {
    await database?.stop();
});

async function selectUser(id: string) {
    return (await db.select().from(user).where(eq(user.id, id)))[0];
}

describe('createUser', () => {
    it('creates a Better Auth user with a uuid id', async () => {
        const email = `atomic-${Date.now()}@example.com`;

        const { id } = await userProvisioning.createUser({
            email,
            name: 'Atomic Ada',
        });

        // Better Auth's `advanced.database.generateId` produced this id via `crypto.randomUUID()`
        // (see auth-options.ts) - it must be UUID-shaped, because `user.id` is a `uuid` column and
        // every application foreign key references it.
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        const authRow = await selectUser(id);

        expect(authRow).toBeDefined();
        expect(authRow.email).toBe(email);
    });

    it('deleting the user removes its credential account too', async () => {
        const email = `cleanup-${Date.now()}@example.com`;
        const authService = new AuthService({ config, userProvisioning });

        const { id } = await userProvisioning.createUser({
            email,
            name: 'Cleanup Casey',
            password: 'a-real-password-123',
        });

        expect(await selectUser(id)).toBeDefined();
        expect(await db.select().from(schema.account).where(eq(schema.account.userId, id))).toHaveLength(1);

        const context = await authService.instance.$context;
        await context.internalAdapter.deleteUser(id);

        expect(await selectUser(id)).toBeUndefined();
        expect(await db.select().from(schema.account).where(eq(schema.account.userId, id))).toHaveLength(0);
    });
});

describe('AuthService - sign-up disabled, sign-in unaffected', () => {
    it("refuses Better Auth's own built-in sign-up path", async () => {
        const authService = new AuthService({ config, userProvisioning });

        // Real call through `auth.api`, not a mock - proves the CONFIG refuses this, not just the
        // doc comment on `UserProvisioningService`. `emailAndPassword.disableSignUp: true` makes
        // `better-auth/dist/api/routes/sign-up.mjs` throw before it ever touches the database.
        await expect(
            authService.instance.api.signUpEmail({
                body: {
                    email: `blocked-signup-${Date.now()}@example.com`,
                    password: 'irrelevant-password-123',
                    name: 'Should Not Exist',
                },
            }),
        ).rejects.toMatchObject({
            status: 'BAD_REQUEST',
            body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' },
        });
    });

    it('the credential createUser writes verifies correctly (real crypto, not a mock)', async () => {
        const email = `sign-in-credential-${Date.now()}@example.com`;
        const password = 'a-real-password-123';

        const { id } = await userProvisioning.createUser({
            email,
            name: 'Signs In Fine',
            password,
        });

        const [accountRow] = await db.select().from(schema.account).where(eq(schema.account.userId, id));
        expect(accountRow).toBeDefined();
        expect(accountRow.providerId).toBe('credential');
        expect(accountRow.password).toBeTruthy();

        // Real `better-auth/crypto` verification, the exact function `/sign-in/email` calls - not
        // a mock. Proves the credential this function writes is cryptographically correct.
        await expect(verifyPassword({ hash: accountRow.password as string, password })).resolves.toBe(true);
    });

    it('signInEmail succeeds end to end for a user created with a password', async () => {
        const authService = new AuthService({ config, userProvisioning });
        const email = `sign-in-works-${Date.now()}@example.com`;
        const password = 'a-real-password-123';

        await userProvisioning.createUser({
            email,
            name: 'Signs In Fine',
            password,
        });

        // The real, non-mocked `auth.api.signInEmail`. This is the end-to-end proof that the
        // authored `account` table and `createCredentialAccount` agree with what
        // `better-auth/dist/api/routes/sign-in.mjs` looks for - notably the `issuer` column, which
        // the CLI's generated schema omits and whose absence makes every sign-in fail with
        // INVALID_EMAIL_OR_PASSWORD.
        const result = await authService.instance.api.signInEmail({ body: { email, password } });
        expect(result.user.email).toBe(email);
    });

    it('signInEmail rejects a wrong password for the same user', async () => {
        const authService = new AuthService({ config, userProvisioning });
        const email = `sign-in-wrong-password-${Date.now()}@example.com`;

        await userProvisioning.createUser({
            email,
            name: 'Wrong Password Wendy',
            password: 'the-correct-password-123',
        });

        await expect(
            authService.instance.api.signInEmail({ body: { email, password: 'definitely-not-the-right-password' } }),
        ).rejects.toMatchObject({
            status: 'UNAUTHORIZED',
            body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
        });
    });

    it('createUser itself is unaffected by disableSignUp', async () => {
        const email = `bypass-unaffected-${Date.now()}@example.com`;

        const { id } = await userProvisioning.createUser({
            email,
            name: 'Bypass Unaffected',
        });

        expect(await selectUser(id)).toBeDefined();
    });
});
