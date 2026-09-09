/**
 * Keys whose value must never reach stdout. Matched by exact key name, not by substring, so a
 * new secret-bearing field has to be added here deliberately.
 */
const SECRET_KEYS = [
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'newPassword',
    'currentPassword',
    'passwordHash',
    'secret',
    'clientSecret',
    'client_secret',
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'idToken',
    'id_token',
    'botToken',
    'apiKey',
    'api_key',
    'encryptionKey',
    'code',
    'codeVerifier',
    'code_verifier',
    'state',
    'connectionDetails',
    'openAiApiKey',
    'connectionString',
] as const;

export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Pino redaction paths. Paths are static and cannot recurse, so each key is listed bare, one
 * level deep and two levels deep, plus the request header positions the serializers produce.
 * A secret buried deeper than that is a sign the payload is too big to be logged at all.
 */
export const REDACT_PATHS: string[] = buildRedactPaths();

function buildRedactPaths(): string[] {
    const paths = SECRET_KEYS.flatMap((key) => {
        const segment = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
        const dotted = segment.startsWith('[') ? segment : `.${segment}`;

        return [segment.replace(/^\./, ''), `*${dotted}`, `*.*${dotted}`];
    });

    return [...new Set([...paths, 'req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]'])];
}
