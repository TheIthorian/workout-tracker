import { createDb } from '@app/db';
import { AppError } from '@app/errors';
import { CommanderError, Command } from 'commander';
import { createUser, formatCreatedUser } from './commands/create-user.js';
import { formatUserList, listUsers } from './commands/list-users.js';
import { formatWorkspaceList, listWorkspaces } from './commands/list-workspaces.js';
import { getAuthConfig, getDatabaseUrl } from './env.js';

type CreateUserOptions = {
    email: string;
    password: string;
    displayName?: string;
};

/**
 * Builds the CLI's command tree without parsing anything, so tests can drive it directly with
 * `program.parseAsync([...], { from: 'user' })` against a throwaway database instead of shelling
 * out to a real process.
 */
export function createProgram(): Command {
    const program = new Command();

    program.name('app-admin').description('Operator commands for inspecting and seeding accounts.').exitOverride();

    program
        .command('list-users')
        .description('List every user with its workspace count and whether it can sign in.')
        .action(async () => {
            await runListUsers();
        });

    program
        .command('list-workspaces')
        .description('List every workspace with its member count and owners.')
        .action(async () => {
            await runListWorkspaces();
        });

    program
        .command('create-user')
        .description(
            "Create a user with a password and their default workspace. Requires AUTH_SECRET to match the API's.",
        )
        .requiredOption('--email <email>', 'Email address for the new user')
        .requiredOption('--password <password>', 'Password for the new user')
        .option('--display-name <name>', 'Display name; defaults to the email')
        .action(async (options: CreateUserOptions) => {
            await runCreateUser(options);
        });

    return program;
}

async function runListUsers(): Promise<void> {
    const { db, close } = createDb({ config: { connectionString: getDatabaseUrl() } });
    try {
        console.log(formatUserList(await listUsers(db)).join('\n'));
    } finally {
        await close();
    }
}

async function runListWorkspaces(): Promise<void> {
    const { db, close } = createDb({ config: { connectionString: getDatabaseUrl() } });
    try {
        console.log(formatWorkspaceList(await listWorkspaces(db)).join('\n'));
    } finally {
        await close();
    }
}

async function runCreateUser(options: CreateUserOptions): Promise<void> {
    // Read before opening a connection: refusing early is the point, and there is nothing this
    // command could usefully do without a secret matching the API's.
    const authConfig = getAuthConfig();

    const { db, close } = createDb({ config: { connectionString: getDatabaseUrl() } });
    try {
        const result = await createUser({
            db,
            authConfig,
            params: {
                email: options.email,
                password: options.password,
                ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
            },
        });

        console.log(formatCreatedUser(result).join('\n'));
    } finally {
        await close();
    }
}

async function main(): Promise<void> {
    const program = createProgram();
    await program.parseAsync(process.argv);
}

// Guarded so tests can `import { createProgram } from './main.js'` and drive it against a
// throwaway database without also triggering a real run against `process.argv` as a side effect
// of the import. `require`/`module` are available because this package has no `"type": "module"`
// in its `package.json`, so NodeNext compiles it to CommonJS.
if (require.main === module) {
    main().catch((error: unknown) => {
        if (error instanceof CommanderError) {
            // Already reported on stderr/stdout by commander itself (bad/missing options, --help,
            // an unknown command) - just propagate the exit code it decided on.
            process.exitCode = error.exitCode;
            return;
        }

        if (error instanceof AppError) {
            console.error(`${error.name}: ${error.message}`);
        } else {
            console.error(error);
        }
        process.exitCode = 1;
    });
}
