import { randomUUID } from 'node:crypto';
import { schema, withTransaction, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { RequestValidationError } from '@app/errors';
import { verifyPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfig } from './auth-options.js';
import { UserProvisioningService } from './user-provisioning.service.js';

const { account, user, workspaces, workspaceUsers } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let userProvisioning: UserProvisioningService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const authConfig: Pick<AuthConfig, 'secret' | 'baseUrl' | 'trustedOrigins'> = {
        secret: 'test-only-secret-does-not-guard-anything-real',
        baseUrl: 'http://localhost:3000',
    };
    userProvisioning = new UserProvisioningService({ db, ...authConfig });
});

afterAll(async () => {
    await database?.stop();
});

describe('createUser', () => {
    it('creates a user with a uuid id and no credential when no password is given', async () => {
        const email = `no-password-${randomUUID()}@example.com`;

        const { id } = await userProvisioning.createUser({ email, name: 'No Password' });

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(await selectUser(id)).toMatchObject({ email, name: 'No Password' });
        expect(await selectAccounts(id)).toHaveLength(0);
    });

    it('creates a usable credential account when a password is given', async () => {
        const email = `with-password-${randomUUID()}@example.com`;

        const { id } = await userProvisioning.createUser({ email, name: 'With Password', password: 'correct-horse' });

        const [credential] = await selectAccounts(id);

        expect(credential.providerId).toBe('credential');
        expect(credential.accountId).toBe(id);
        expect(await verifyPassword({ hash: credential.password ?? '', password: 'correct-horse' })).toBe(true);
    });
});

describe('createCredentialAccount', () => {
    it('gives an existing passwordless user a working credential', async () => {
        const email = `later-credential-${randomUUID()}@example.com`;
        const { id } = await userProvisioning.createUser({ email, name: 'Later Credential' });

        await withTransaction(db, (tx) =>
            userProvisioning.createCredentialAccount(tx, { userId: id, password: 'hunter22' }),
        );

        const [credential] = await selectAccounts(id);

        expect(await verifyPassword({ hash: credential.password ?? '', password: 'hunter22' })).toBe(true);
    });
});

describe('signUp', () => {
    it('creates the user and defaults the display name to the email', async () => {
        const email = `signup-default-name-${randomUUID()}@example.com`;

        const { id } = await userProvisioning.signUp({ email, password: 'correct-horse' });

        expect(await selectUser(id)).toMatchObject({ email, name: email });
    });

    it('uses displayName as the user name when given', async () => {
        const email = `signup-named-${randomUUID()}@example.com`;

        const { id } = await userProvisioning.signUp({ email, password: 'correct-horse', displayName: 'Ada Lovelace' });

        expect(await selectUser(id)).toMatchObject({ name: 'Ada Lovelace' });
    });

    it('creates a default workspace the new user owns', async () => {
        const email = `signup-workspace-${randomUUID()}@example.com`;

        const { id, workspaceId } = await userProvisioning.signUp({
            email,
            password: 'correct-horse',
            displayName: 'Ada Lovelace',
        });

        const memberships = await db.select().from(workspaceUsers).where(eq(workspaceUsers.userId, id));
        expect(memberships).toEqual([expect.objectContaining({ workspaceId, role: 'owner' })]);

        const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
        expect(workspace.name).toBe("Ada Lovelace's Workspace");
    });

    it('names the default workspace after the email when no displayName is given', async () => {
        const email = `signup-workspace-default-${randomUUID()}@example.com`;

        const { workspaceId } = await userProvisioning.signUp({ email, password: 'correct-horse' });

        const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
        expect(workspace.name).toBe(`${email}'s Workspace`);
    });

    it('falls back to the email when displayName is blank', async () => {
        const email = `signup-blank-name-${randomUUID()}@example.com`;

        const { id } = await userProvisioning.signUp({ email, password: 'correct-horse', displayName: '   ' });

        expect(await selectUser(id)).toMatchObject({ name: email });
    });

    it('rejects a duplicate email as a validation error, not a raw constraint violation', async () => {
        const email = `signup-duplicate-${randomUUID()}@example.com`;
        await userProvisioning.signUp({ email, password: 'correct-horse' });

        await expect(userProvisioning.signUp({ email, password: 'correct-horse' })).rejects.toBeInstanceOf(
            RequestValidationError,
        );
    });

    it.each([
        ['a missing email', { email: '', password: 'correct-horse' }, 'email'],
        ['a malformed email', { email: 'not-an-email', password: 'correct-horse' }, 'email'],
        ['a missing password', { email: 'valid@example.com', password: '' }, 'password'],
        ['a password under 8 characters', { email: 'valid@example.com', password: 'short' }, 'password'],
    ])('rejects %s before touching the database', async (_name, params, field) => {
        await expect(userProvisioning.signUp(params)).rejects.toMatchObject({
            problem: { errors: { [field]: expect.any(Array) } },
        });
    });

    it('leaves no user behind when validation fails', async () => {
        const email = `signup-invalid-${randomUUID()}@example.com`;

        await expect(userProvisioning.signUp({ email, password: 'short' })).rejects.toBeInstanceOf(
            RequestValidationError,
        );

        expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0);
    });

    it('is one transaction: a failed workspace write leaves no user behind', async () => {
        const email = `signup-atomic-${randomUUID()}@example.com`;
        const displayName = 'Rollback Probe';
        const workspacesBefore = (await db.select().from(workspaces)).length;

        // A real database constraint, not a mocked query builder: the workspace insert is the
        // SECOND write in signUp's transaction, so rejecting it proves the first one (the user) is
        // rolled back with it rather than committed independently.
        //
        // `sql.raw` because DDL cannot take bind parameters. The interpolated value is this file's
        // own constant, never anything caller-supplied.
        await db.execute(
            sql.raw(
                `alter table workspaces add constraint rollback_probe check (name <> '${displayName}''s Workspace')`,
            ),
        );

        try {
            await expect(userProvisioning.signUp({ email, password: 'correct-horse', displayName })).rejects.toThrow();
        } finally {
            await db.execute(sql`alter table workspaces drop constraint rollback_probe`);
        }

        expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0);
        expect(await db.select().from(workspaces)).toHaveLength(workspacesBefore);
    });
});

async function selectUser(id: string) {
    return (await db.select().from(user).where(eq(user.id, id)))[0];
}

async function selectAccounts(userId: string) {
    return db.select().from(account).where(eq(account.userId, userId));
}
