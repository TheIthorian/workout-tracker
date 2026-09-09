import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './load-env.js';

const BASE_ENV = {
    WEB_APP_BASE_URL: 'http://localhost:5173',
    API_BASE_URL: 'http://localhost:3000',
    MCP_BASE_URL: 'http://localhost:3100',
};

const ENV_KEYS = ['WEB_APP_BASE_URL', 'API_BASE_URL', 'API_INTERNAL_BASE_URL', 'MCP_BASE_URL'];

describe('loadEnv', () => {
    afterEach(() => {
        resetEnvCache();
        for (const key of ENV_KEYS) delete process.env[key];
    });

    // The failure mode of getting this wrong is silent, not loud: a stale or accidentally-blank
    // API_INTERNAL_BASE_URL would send the MCP token's bearer requests to the wrong origin rather
    // than failing to boot. Pins the `Joi.ref` default against a future schema refactor - see
    // `load-env.ts`'s comment on the variable for why the two origins are separate concerns.
    it('defaults API_INTERNAL_BASE_URL to API_BASE_URL when unset', () => {
        Object.assign(process.env, BASE_ENV);
        // `Joi.ref` only falls through to the referenced value when the key is genuinely absent -
        // not merely `undefined` or `''`, both of which are values `Joi.string()` treats as
        // present (and rejects, since neither satisfies `.string()`). `BASE_ENV` never assigned
        // this key, but `delete` here guards against a leftover from another test's `Object.assign`.
        delete process.env['API_INTERNAL_BASE_URL'];

        const env = loadEnv();

        expect(env['API_INTERNAL_BASE_URL']).toBe(BASE_ENV.API_BASE_URL);
    });

    it('keeps an explicit API_INTERNAL_BASE_URL rather than the API_BASE_URL fallback', () => {
        Object.assign(process.env, BASE_ENV, { API_INTERNAL_BASE_URL: 'http://internal-api.test' });

        const env = loadEnv();

        expect(env['API_INTERNAL_BASE_URL']).toBe('http://internal-api.test');
        expect(env['API_INTERNAL_BASE_URL']).not.toBe(BASE_ENV.API_BASE_URL);
    });
});
