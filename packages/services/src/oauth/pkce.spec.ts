import { createHash } from 'node:crypto';
import { CodeChallengeMethod } from '@app/api-contract';
import { describe, expect, it } from 'vitest';
import { isSupportedCodeChallengeMethod, verifyCodeChallenge } from './pkce.js';

const VERIFIER = 'a-code-verifier-with-enough-entropy-to-be-real';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

describe('isSupportedCodeChallengeMethod', () => {
    it('accepts S256 and nothing else', () => {
        expect(isSupportedCodeChallengeMethod('S256')).toBe(true);
        // OAuth 2.1 removed `plain`; accepting it would make an intercepted code replayable.
        expect(isSupportedCodeChallengeMethod('plain')).toBe(false);
        expect(isSupportedCodeChallengeMethod('')).toBe(false);
    });
});

describe('verifyCodeChallenge', () => {
    it('accepts the verifier the challenge was derived from', () => {
        expect(
            verifyCodeChallenge({
                codeVerifier: VERIFIER,
                codeChallenge: CHALLENGE,
                codeChallengeMethod: CodeChallengeMethod.S256,
            }),
        ).toBe(true);
    });

    it('refuses any other verifier', () => {
        expect(
            verifyCodeChallenge({
                codeVerifier: `${VERIFIER}x`,
                codeChallenge: CHALLENGE,
                codeChallengeMethod: CodeChallengeMethod.S256,
            }),
        ).toBe(false);
    });

    it('refuses a challenge of a different length without throwing', () => {
        expect(
            verifyCodeChallenge({
                codeVerifier: VERIFIER,
                codeChallenge: 'short',
                codeChallengeMethod: CodeChallengeMethod.S256,
            }),
        ).toBe(false);
    });
});
