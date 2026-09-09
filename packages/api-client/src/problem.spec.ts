import { describe, expect, it } from 'vitest';
import { AppError } from '@app/errors';
import { toAppError } from './problem.js';

describe('toAppError', () => {
    it('carries the API problem body through verbatim', () => {
        const problem = {
            type: 'https://example.com/errors/EntityNotFoundError',
            title: 'Item not found',
            status: 404,
            detail: 'no item',
        };
        const error = toAppError({ status: 404, body: problem });

        expect(error).toBeInstanceOf(AppError);
        expect(error.problem).toEqual(problem);
        expect(error.statusCode).toBe(404);
    });

    // Pins the fix for a real regression: the API's RequestValidationError (packages/errors/src/
    // app-error.ts) puts a field-keyed `errors` dict on the wire, thrown by the zod validation
    // pipe on every bad POST/PATCH body. `toAppError` must not drop it - the docstring's claim of
    // an unchanged passthrough is only true if fields ProblemDetails doesn't know about survive too.
    it('carries an unknown field like a validation errors dict through unchanged', () => {
        const problem = {
            type: 'https://example.com/errors/RequestValidationError',
            title: 'Request validation failed',
            status: 400,
            detail: 'One or more validation errors occurred.',
            errors: { name: ['must not be empty'], quantity: ['must be a positive number'] },
        };

        const error = toAppError({ status: 400, body: problem });

        expect(error.problem).toEqual(problem);
        expect((error.problem as typeof problem).errors).toEqual(problem.errors);
    });

    it('synthesises a problem when the response body is not one', () => {
        const error = toAppError({ status: 404, body: {} });

        expect(error.problem.status).toBe(404);
        expect(error.problem.title).toBeDefined();
    });

    // A 5xx is not an application error. Six tools catch AppError and return its problem body as a
    // SUCCESSFUL result; an outage reported that way would tell the model the server's answer was
    // "internal server error" rather than that the call failed.
    it('refuses to map a 500', () => {
        expect(() => toAppError({ status: 500, body: {} })).toThrow();
    });
});
