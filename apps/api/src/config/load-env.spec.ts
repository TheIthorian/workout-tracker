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
    CATALOG_IMAGE_BASE_URL: 'http://localhost:9000/wt-app',
    MCP_OAUTH_VERIFIED_CLIENT_IDS: 'https://claude.ai/oauth/client',
    S3_BUCKET: 'wt-app',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
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
    'CATALOG_IMAGE_BASE_URL',
    'MCP_OAUTH_VERIFIED_CLIENT_IDS',
];

describe('loadEnv', () => {
    afterEach(() => {
        resetEnvCache();
        for (const key of MANAGED_KEYS) {
            delete process.env[key];
        }
    });

    it.each([
        'DATABASE_URL',
        'AUTH_SECRET',
        'AUTH_BASE_URL',
        'WEB_APP_BASE_URL',
        'API_BASE_URL',
        'MCP_BASE_URL',
        'CATALOG_IMAGE_BASE_URL',
        'MCP_OAUTH_VERIFIED_CLIENT_IDS',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
    ])('rejects a missing %s', (key) => {
        Object.assign(process.env, BASE_ENV);
        delete process.env[key];

        expect(() => loadEnv()).toThrow(ConfigurationError);
    });

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

    // Guide images are core to this app, so the bucket and its credentials are required (asserted
    // above). Only the addressing settings still default - an unset endpoint means real AWS S3.
    it('defaults the S3 addressing settings around the required bucket', () => {
        Object.assign(process.env, BASE_ENV);

        const env = loadEnv();

        expect(env['S3_BUCKET']).toBe('wt-app');
        expect(env['S3_REGION']).toBe('us-east-1');
        expect(env['S3_ENDPOINT']).toBeUndefined();
        expect(env['S3_FORCE_PATH_STYLE']).toBe(true);
    });
});
