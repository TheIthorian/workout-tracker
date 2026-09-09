import { ConfigurationError } from '@app/errors';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './load-env.js';

const BASE_ENV = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
    AUTH_SECRET: 'a-very-secret-value',
    AUTH_BASE_URL: 'http://localhost:3000',
    WEB_APP_BASE_URL: 'http://localhost:5173',
    API_BASE_URL: 'http://localhost:3000',
    MCP_BASE_URL: 'http://localhost:3100',
};

const MANAGED_KEYS = [
    'DATABASE_URL',
    'AUTH_SECRET',
    'AUTH_BASE_URL',
    'LLM_API_KEY',
    'PORT',
    'LOG_LEVEL',
    'NODE_ENV',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_FORCE_PATH_STYLE',
    'WEB_APP_BASE_URL',
    'API_BASE_URL',
    'MCP_BASE_URL',
];

describe('loadEnv', () => {
    afterEach(() => {
        resetEnvCache();
        for (const key of MANAGED_KEYS) {
            delete process.env[key];
        }
    });

    it.each(['DATABASE_URL', 'AUTH_SECRET', 'AUTH_BASE_URL', 'WEB_APP_BASE_URL', 'API_BASE_URL', 'MCP_BASE_URL'])(
        'rejects a missing %s',
        (key) => {
            Object.assign(process.env, BASE_ENV);
            delete process.env[key];

            expect(() => loadEnv()).toThrow(ConfigurationError);
        },
    );

    it('rejects a non-numeric PORT', () => {
        Object.assign(process.env, BASE_ENV, { PORT: 'not-a-number' });

        expect(() => loadEnv()).toThrow(ConfigurationError);
    });

    it('defaults LOG_LEVEL to info and NODE_ENV to development', () => {
        Object.assign(process.env, BASE_ENV);

        const env = loadEnv();

        expect(env['LOG_LEVEL']).toBe('info');
        expect(env['NODE_ENV']).toBe('development');
    });

    // See `load-env.ts`: a blank key is a supported "LLM disabled" deployment, not a boot failure.
    it('defaults LLM_API_KEY to a blank string', () => {
        Object.assign(process.env, BASE_ENV);

        expect(loadEnv()['LLM_API_KEY']).toBe('');
    });

    // Also optional as a group, so the template boots with no object storage at all. Make
    // S3_BUCKET `.required()` in `load-env.ts` once your app genuinely depends on storage.
    it('defaults the S3 group rather than failing to boot without it', () => {
        Object.assign(process.env, BASE_ENV);

        const env = loadEnv();

        expect(env['S3_BUCKET']).toBe('');
        expect(env['S3_REGION']).toBe('us-east-1');
        expect(env['S3_ENDPOINT']).toBeUndefined();
        expect(env['S3_FORCE_PATH_STYLE']).toBe(true);
    });
});
