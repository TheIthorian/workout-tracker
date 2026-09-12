import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { ConfigurationError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { resetEnvCache } from './env.js';
import { createProgram } from './main.js';

const { user, workspaceUsers, workspaces } = schema;

const AUTH_SECRET = 'test-secret-value-not-for-production-use';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    // `getDatabaseUrl()` reads this through `@app/env`'s loader, which caches its result per module
    // instance - set it before the first command runs in this file, and never against anything but
    // this throwaway container.
    process.env['DATABASE_URL'] = database.connectionString;
    process.env['AUTH_SECRET'] = AUTH_SECRET;
});

afterAll(async () => {
    await database?.stop();
});

afterEach(async () => {
    await db.delete(workspaceUsers);
    await db.delete(workspaces);
    await db.delete(user);

    process.env['AUTH_SECRET'] = AUTH_SECRET;
    resetEnvCache();
    vi.restoreAllMocks();
});

/** Runs a command through the real program, capturing what it wrote to stdout. */
async function run(argv: string[]): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
        lines.push(String(message));
    });

    await createProgram().parseAsync(argv, { from: 'user' });

    return lines.join('\n');
}

describe('list-users', () => {
    it('prints a table of the users in the database', async () => {
        await insertUser('operator@example.com');

        expect(await run(['list-users'])).toContain('operator@example.com');
    });

    it('prints only the header for an empty database', async () => {
        const output = await run(['list-users']);

        expect(output).toContain('Email');
        expect(output.split('\n')).toHaveLength(2);
    });
});

describe('list-workspaces', () => {
    it('prints a table of the workspaces in the database', async () => {
        const ownerId = await insertUser('owner@example.com');
        const workspaceId = randomUUID();
        await db.insert(workspaces).values({ id: workspaceId, name: 'Acme' });
        await db.insert(workspaceUsers).values({ workspaceId, userId: ownerId, role: 'owner' });

        const output = await run(['list-workspaces']);

        expect(output).toContain('Acme');
        expect(output).toContain('owner@example.com');
    });
});

describe('create-user', () => {
    it('creates the account and prints its ids', async () => {
        const output = await run([
            'create-user',
            '--email',
            'seeded@example.com',
            '--password',
            'correct-horse',
            '--display-name',
            'Seeded',
        ]);

        const [row] = await db.select().from(user).where(eq(user.email, 'seeded@example.com'));
        expect(row.name).toBe('Seeded');
        expect(output).toContain(row.id);
    });

    // A credential hashed against a different secret than the API verifies with produces an account
    // that looks fine here and cannot sign in there, so refusing outright beats guessing a default.
    it('refuses to run without AUTH_SECRET, and writes nothing', async () => {
        delete process.env['AUTH_SECRET'];
        resetEnvCache();

        await expect(
            run(['create-user', '--email', 'nope@example.com', '--password', 'correct-horse']),
        ).rejects.toBeInstanceOf(ConfigurationError);

        expect(await db.select().from(user).where(eq(user.email, 'nope@example.com'))).toHaveLength(0);
    });

    it('requires an email and a password', async () => {
        await expect(run(['create-user', '--email', 'missing-password@example.com'])).rejects.toThrow();
    });
});

describe('seed-exercises', () => {
    // `pnpm --filter @app/admin start seed-exercises` runs with cwd `apps/admin`, so the default
    // must be resolved relative to the module rather than left as a bare relative path that would
    // land in `apps/admin/content/exercises` and fail.
    it('defaults --dir to the repository content directory, and it exists', () => {
        const seedCommand = createProgram().commands.find((command) => command.name() === 'seed-exercises');
        const dirOption = seedCommand?.options.find((option) => option.long === '--dir');

        expect(dirOption?.defaultValue).toMatch(/\/content\/exercises$/);
        expect(existsSync(String(dirOption?.defaultValue))).toBe(true);
    });
});

async function insertUser(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(user).values({ id, name: email, email, updatedAt: new Date() });
    return id;
}
