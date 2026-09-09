import type { Schema } from 'joi';
import { ConfigurationError } from '@app/errors';
import { LOG_LEVELS, type LoggerConfig, type LogLevel } from '@app/logger';

// Nest's own defaults when it is handed a validationSchema. Unknown keys have to be allowed
// because process.env carries PATH, HOME and everything else the OS put there.
const VALIDATION_OPTIONS = { allowUnknown: true, abortEarly: false } as const;

/** The environment accessors one app gets from {@link createEnvLoader}. */
export type EnvLoader = {
    loadEnv(): Record<string, unknown>;
    toLoggerConfig(env: Record<string, unknown>): LoggerConfig;
    resetEnvCache(): void;
};

/**
 * Builds the environment accessors for one app around its own Joi schema.
 *
 * Each loader owns a private cache, so validation happens once per app: bootstrap calls it before
 * Nest exists in order to build a logger from the result, and `ConfigModule` is handed the same
 * cached object rather than re-validating. Two validation points drift, and the earlier one wins
 * silently.
 *
 * @param schema the app's environment schema, which is the only part that differs between apps.
 * @param bypass returns a substitute environment to use instead of validating, or `undefined` to
 * validate normally. For the case where an app is booted by a tool that has no environment at all.
 */
export function createEnvLoader({
    schema,
    bypass,
}: {
    schema: Schema;
    bypass?: () => Record<string, unknown> | undefined;
}): EnvLoader {
    let cached: Record<string, unknown> | undefined;

    return { loadEnv, toLoggerConfig, resetEnvCache };

    function loadEnv(): Record<string, unknown> {
        if (cached) return cached;

        cached = bypass?.() ?? validate(process.env);

        return cached;
    }

    function resetEnvCache(): void {
        cached = undefined;
    }

    function validate(env: NodeJS.ProcessEnv): Record<string, unknown> {
        const { error, value } = schema.validate(env, VALIDATION_OPTIONS);

        if (error) throw new ConfigurationError(`Invalid environment: ${error.message}`);

        return value as Record<string, unknown>;
    }
}

/**
 * Narrows validated env to what the logger needs, so `@app/logger` never sees the environment.
 *
 * Deliberately supplies no defaults of its own: the schema already applied them, and a second set
 * here would be the pair of definitions that let the first pair drift apart.
 *
 * @throws ConfigurationError when called with an environment that has not been through the schema.
 */
export function toLoggerConfig(env: Record<string, unknown>): LoggerConfig {
    const level = env['LOG_LEVEL'];
    const pretty = env['LOG_PRETTY'];
    const redact = env['LOG_REDACT'];

    if (!isLogLevel(level) || typeof pretty !== 'boolean' || typeof redact !== 'boolean') {
        throw new ConfigurationError(
            'Logging config is missing or untyped. toLoggerConfig takes the output of loadEnv, ' +
                'which is where LOG_LEVEL is required and the two switches are defaulted and coerced.',
        );
    }

    return { level, pretty, redact };
}

function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}
