import 'reflect-metadata';
import { setProblemTypeBase } from '@app/errors';
import { createApp } from './bootstrap.js';
import { loadEnv } from './config/load-env.js';

async function bootstrap(): Promise<void> {
    // Before createApp, so nothing can build a problem body against the old base first.
    setProblemTypeBase(String(loadEnv()['PROBLEM_TYPE_BASE']));

    const app = await createApp();
    await app.listen(Number(loadEnv()['PORT']), '::');
}

void bootstrap();
