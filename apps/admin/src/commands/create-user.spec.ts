import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { RequestValidationError } from '@app/errors';
import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { createUser, formatCreatedUser } from './create-user.js';

const { account, user, workspaceUsers, workspaces } = schema;

const AUTH_CONFIG = { secret: 'test-secret-value-not-for-production-use', baseUrl: 'http://localhost:3000' };

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database?.stop();
});

afterEach(async () => {
    await db.delete(workspaceUsers);
    await db.delete(workspaces);
    await db.delete(user);
});

describe('createUser', () => {
    it('creates the user, a credential, and an owned default workspace', async () => {
        const result = await createUser({
            db,
            authConfig: AUTH_CONFIG,
            params: { email: 'admin@example.com', password: 'correct-horse', displayName: 'Admin' },
        });

        const [row] = await db.select().from(user).where(eq(user.id, result.id));
        expect(row).toMatchObject({ email: 'admin@example.com', name: 'Admin' });

        const memberships = await db.select().from(workspaceUsers).where(eq(workspaceUsers.userId, result.id));
        expect(memberships).toEqual([expect.objectContaining({ workspaceId: result.workspaceId, role: 'owner' })]);
    });

    // The point of going through the real service: a hand-inserted row would produce an account
    // that exists and cannot sign in.
    it('writes a credential the real sign-in hasher verifies', async () => {
        const result = await createUser({
            db,
            authConfig: AUTH_CONFIG,
            params: { email: 'verifiable@example.com', password: 'correct-horse' },
        });

        const [credential] = await db.select().from(account).where(eq(account.userId, result.id));

        expect(credential.providerId).toBe('credential');
        expect(await verifyPassword({ hash: credential.password ?? '', password: 'correct-horse' })).toBe(true);
    });

    it('defaults the display name to the email', async () => {
        const result = await createUser({
            db,
            authConfig: AUTH_CONFIG,
            params: { email: 'no-name@example.com', password: 'correct-horse' },
        });

        const [row] = await db.select().from(user).where(eq(user.id, result.id));
        expect(row.name).toBe('no-name@example.com');
    });

    it('rejects a duplicate email', async () => {
        const params = { email: 'taken@example.com', password: 'correct-horse' };
        await createUser({ db, authConfig: AUTH_CONFIG, params });

        await expect(createUser({ db, authConfig: AUTH_CONFIG, params })).rejects.toBeInstanceOf(
            RequestValidationError,
        );
    });

    // This command seeds an admin; it must not be a way to create an account weaker than sign-up
    // would allow.
    it('applies the same password rules as sign-up', async () => {
        await expect(
            createUser({
                db,
                authConfig: AUTH_CONFIG,
                params: { email: 'weak@example.com', password: 'short' },
            }),
        ).rejects.toBeInstanceOf(RequestValidationError);
    });
});

describe('formatCreatedUser', () => {
    it('reports the ids without ever echoing the password', () => {
        const lines = formatCreatedUser({ id: 'u1', workspaceId: 'w1', email: 'a@example.com' });

        expect(lines.join('\n')).toContain('a@example.com');
        expect(lines.join('\n')).toContain('w1');
        expect(lines.join('\n')).not.toContain('correct-horse');
    });
});
