import { afterEach, describe, expect, it } from 'vitest';
import { buildProblem, getProblemTypeBase, PROBLEM_TYPE_BASE, setProblemTypeBase } from './problem-details.js';

// The base is module-level state, so a test that changed it and did not put it back would leak into
// every later assertion about a problem body - here and in any suite sharing this module instance.
afterEach(() => {
    setProblemTypeBase(PROBLEM_TYPE_BASE);
});

describe('problem type base', () => {
    it('starts at the packaged default', () => {
        expect(getProblemTypeBase()).toBe(PROBLEM_TYPE_BASE);
        expect(buildProblem({ errorName: 'EntityNotFoundError', title: 'Not found', status: 404 }).type).toBe(
            `${PROBLEM_TYPE_BASE}/EntityNotFoundError`,
        );
    });

    it('builds every subsequent problem against an overridden base', () => {
        setProblemTypeBase('https://api.example.com/errors');

        expect(buildProblem({ errorName: 'ConflictError', title: 'Conflict', status: 409 }).type).toBe(
            'https://api.example.com/errors/ConflictError',
        );
    });

    // A configured value with a trailing slash must not produce a doubled one, for the same reason
    // `ResourceUrlGenerator` strips them: the value comes from a deployment's environment.
    it('tolerates a trailing slash on the configured base', () => {
        setProblemTypeBase('https://api.example.com/errors//');

        expect(buildProblem({ errorName: 'ConflictError', title: 'Conflict', status: 409 }).type).toBe(
            'https://api.example.com/errors/ConflictError',
        );
    });
});
