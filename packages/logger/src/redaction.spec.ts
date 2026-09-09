import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './redaction.js';

describe('REDACT_PATHS', () => {
    it('covers the secrets this domain handles', () => {
        for (const path of [
            'req.headers.cookie',
            'req.headers.authorization',
            '*.passwordHash',
            '*.accessToken',
            '*.openAiApiKey',
            '*.connectionString',
        ]) {
            expect(REDACT_PATHS).toContain(path);
        }
    });

    it('covers a plaintext password at every nesting depth it can appear at', () => {
        // Sign-in and sign-up bodies carry one. If this ever stops being redacted, real passwords
        // go to stdout and nothing fails loudly.
        for (const path of ['password', '*.password', '*.*.password']) {
            expect(REDACT_PATHS).toContain(path);
        }
    });
});
