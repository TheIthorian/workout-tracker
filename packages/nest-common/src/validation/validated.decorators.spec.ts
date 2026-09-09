import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EntityNotFoundError, RequestValidationError } from '@app/errors';
import { ValidatedParamPipe } from './validated.decorators.js';

const guidSchema = z.uuid();

describe('ValidatedParamPipe', () => {
    it('returns the parsed value on success', () => {
        const value = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

        expect(new ValidatedParamPipe(guidSchema).transform(value)).toBe(value);
    });

    // A path segment that cannot be a valid id names no resource, so 404 is the honest answer. A
    // zod pipe on its own throws a 400 RequestValidationError, so ValidatedParamPipe rethrows as
    // EntityNotFoundError. Do not "fix" this to 400 - that would let a caller tell "wrong shape"
    // apart from "no such row".
    it('yields a 404 EntityNotFoundError, not a 400, for a malformed path parameter', () => {
        try {
            new ValidatedParamPipe(guidSchema).transform('not-a-guid');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(EntityNotFoundError);
            expect(error).not.toBeInstanceOf(RequestValidationError);
            expect((error as EntityNotFoundError).problem.status).toBe(404);
        }
    });
});
