import 'reflect-metadata';
import { runMigrations } from '@app/db';
import { setProblemTypeBase } from '@app/errors';
import { createLogger } from '@app/logger';
import { createApp } from './bootstrap.js';
import { seedCatalogOnStartup } from './startup/seed-catalog.js';
import { loadEnv, toLoggerConfig } from './config/load-env.js';

async function bootstrap(): Promise<void> {
    const env = loadEnv();

    // Before createApp, so nothing can build a problem body against the old base first.
    setProblemTypeBase(String(env['PROBLEM_TYPE_BASE']));

    // Before the app is constructed, not after: a half-migrated schema should keep the old
    // release serving rather than let this one start answering queries against missing columns.
    if (env['DB_MIGRATE_ON_STARTUP'] === true) {
        await runMigrations({
            connectionString: String(env['DATABASE_URL']),
            logger: createLogger({ context: 'api-migrate', config: toLoggerConfig(env) }),
        });
    }

    const app = await createApp();
    await app.listen(Number(env['PORT']), '::');

    // After listen, unawaited: the catalog is content, not schema, and the app answers correctly
    // without it. Blocking the readiness probe on an object-storage round trip would turn a slow
    // bucket into a failed deploy.
    void seedCatalogOnStartup({ app }).catch((error: unknown) => {
        createLogger({ context: 'api-seed', config: toLoggerConfig(env) }).error(
            { err: error },
            'Exercise catalog seed failed; the API is serving whatever the catalog already held',
        );
    });
}

void bootstrap();
