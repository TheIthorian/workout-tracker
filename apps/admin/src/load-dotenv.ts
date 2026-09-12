import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenvFile } from 'dotenv';

/** The file that marks an app's own root, used to locate its `.env` from wherever it was started. */
const APP_MARKER = 'package.json';

/**
 * Walks up from this module's directory to the app's own root - the nearest ancestor with a
 * `package.json`, i.e. `apps/admin`, whether running from `src` under vitest or `dist` in production.
 *
 * Deliberately NOT the monorepo root: config belongs to the app that consumes it, so a second app
 * gets its own `.env` rather than sharing one. Deliberately not `process.cwd()` either, which would
 * make the config silently depend on the directory the server happened to be started from.
 */
function findAppRoot(startDir: string): string | undefined {
    let current = startDir;

    for (;;) {
        if (existsSync(join(current, APP_MARKER))) return current;

        const parent = dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/**
 * Loads this app's `.env` (`apps/admin/.env`) into `process.env`, if there is one.
 *
 * Called for its side effect before {@link loadEnv} validates the environment, so that a local
 * `.env` is enough to start the server - rather than every developer needing a wrapper script that
 * exports the variables first.
 *
 * Two properties matter, and both are load-bearing:
 *
 * 1. **It never overrides a variable that is already set.** A real deployment sets its configuration
 *    in the environment, and a stray `.env` on the box must not be able to silently replace it.
 *    `dotenv`'s default is `override: false`; it is passed explicitly here because the whole
 *    guarantee rests on it.
 *
 * 2. **It does nothing under vitest.** `test/harness.ts` assigns every variable with `??=`, so a
 *    `.env`-provided value would WIN over the harness's own - and a developer with a real
 *    `DATABASE_URL` in `.env` would run the entire suite against their live database instead of a
 *    testcontainer. Those suites truncate tables. Vitest sets `VITEST=true` in the test process
 *    (verified empirically, not assumed), which is what this checks.
 *
 * @returns the path loaded, or `undefined` if nothing was loaded - for logging and for the tests.
 */
export function loadDotenv(): string | undefined {
    if (process.env['VITEST']) return undefined;

    const appRoot = findAppRoot(__dirname);
    if (appRoot === undefined) return undefined;

    const envPath = join(appRoot, '.env');
    if (!existsSync(envPath)) return undefined;

    loadDotenvFile({ path: envPath, override: false, quiet: true });

    return envPath;
}
