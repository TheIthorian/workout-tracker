import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import Joi from 'joi';
import { ConfigurationError } from '@app/errors';
import { LOG_LEVELS } from '@app/logger';
import { createEnvLoader, toLoggerConfig } from './create-env-loader.js';

const schema = Joi.object({
    PORT: Joi.number().required(),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
    LOG_LEVEL: Joi.string()
        .valid(...LOG_LEVELS)
        .required(),
    LOG_PRETTY: Joi.boolean().optional().default(false),
    LOG_REDACT: Joi.boolean().optional().default(true),
});

const REQUIRED = { PORT: '3000', NODE_ENV: 'test', LOG_LEVEL: 'info' };

const original = { ...process.env };

let loader = createEnvLoader({ schema });

beforeEach(() => {
    loader = createEnvLoader({ schema });
});

afterEach(() => {
    process.env = { ...original };
});

describe('createEnvLoader', () => {
    it('coerces and defaults the logging variables', () => {
        setEnv(REQUIRED);

        expect(loader.loadEnv()).toMatchObject({ LOG_LEVEL: 'info', LOG_PRETTY: false, LOG_REDACT: true });
    });

    it('validates once and reuses the result', () => {
        setEnv(REQUIRED);

        const first = loader.loadEnv();
        process.env['LOG_LEVEL'] = 'trace';

        // The second call must not re-read: bootstrap and ConfigModule have to agree on one answer.
        expect(loader.loadEnv()).toBe(first);
        expect(loader.loadEnv()['LOG_LEVEL']).toBe('info');
    });

    it('throws a typed error when the environment is invalid', () => {
        setEnv({ ...REQUIRED, LOG_LEVEL: 'verbose' });

        expect(() => loader.loadEnv()).toThrow(ConfigurationError);
        expect(() => loader.loadEnv()).toThrow(/LOG_LEVEL/);
    });

    it('keeps the variables the schema does not name', () => {
        setEnv({ ...REQUIRED, SOME_OTHER_VAR: 'kept' });

        expect(loader.loadEnv()).toMatchObject({ SOME_OTHER_VAR: 'kept' });
    });

    it('resetEnvCache makes the next call re-read', () => {
        setEnv(REQUIRED);

        loader.loadEnv();
        loader.resetEnvCache();
        setEnv({ ...REQUIRED, LOG_LEVEL: 'debug' });

        expect(loader.loadEnv()['LOG_LEVEL']).toBe('debug');
    });

    it('gives each app its own cache', () => {
        setEnv(REQUIRED);

        const other = createEnvLoader({ schema });

        expect(other.loadEnv()).not.toBe(loader.loadEnv());
    });

    it('uses the bypass instead of validating when it returns a value', () => {
        setEnv({ NOTHING_VALID: 'true' });

        const bypassed = createEnvLoader({ schema, bypass: () => ({ LOG_LEVEL: 'error' }) });

        expect(bypassed.loadEnv()).toEqual({ LOG_LEVEL: 'error' });
    });

    it('validates normally when the bypass returns undefined', () => {
        setEnv(REQUIRED);

        const bypassed = createEnvLoader({ schema, bypass: () => undefined });

        expect(bypassed.loadEnv()).toMatchObject({ LOG_LEVEL: 'info' });
    });
});

describe('toLoggerConfig', () => {
    it('narrows validated env to the logger config', () => {
        setEnv(REQUIRED);

        expect(toLoggerConfig(loader.loadEnv())).toEqual({ level: 'info', pretty: false, redact: true });
    });

    it('refuses raw process.env, which has not been coerced', () => {
        expect(() => toLoggerConfig({ LOG_LEVEL: 'info', LOG_PRETTY: 'false', LOG_REDACT: 'true' })).toThrow(
            ConfigurationError,
        );
    });
});

function setEnv(env: Record<string, string>): void {
    process.env = { ...env };
}
