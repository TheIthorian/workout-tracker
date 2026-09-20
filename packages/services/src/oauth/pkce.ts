import { createHash, timingSafeEqual } from 'node:crypto';
import { CodeChallengeMethod } from '@app/api-contract';

/** Narrows an unchecked method string — one off a query string, or out of a stored row. */
export function isSupportedCodeChallengeMethod(method: string): method is CodeChallengeMethod {
    return Object.values(CodeChallengeMethod).includes(method as CodeChallengeMethod);
}

/** Checks a PKCE `code_verifier` against the challenge recorded with the authorization code. */
export function verifyCodeChallenge({
    codeVerifier,
    codeChallenge,
    codeChallengeMethod,
}: {
    codeVerifier: string;
    codeChallenge: string;
    codeChallengeMethod: CodeChallengeMethod;
}): boolean {
    const expected = Buffer.from(transformVerifier({ codeVerifier, codeChallengeMethod }), 'utf8');
    const presented = Buffer.from(codeChallenge, 'utf8');

    if (expected.length !== presented.length) return false;

    return timingSafeEqual(expected, presented);
}

// Exhaustive over CodeChallengeMethod: adding a method fails to compile until its transform is
// written here, rather than silently falling through to the S256 branch.
function transformVerifier({
    codeVerifier,
    codeChallengeMethod,
}: {
    codeVerifier: string;
    codeChallengeMethod: CodeChallengeMethod;
}): string {
    switch (codeChallengeMethod) {
        case CodeChallengeMethod.S256:
            return createHash('sha256').update(codeVerifier).digest('base64url');
    }
}
