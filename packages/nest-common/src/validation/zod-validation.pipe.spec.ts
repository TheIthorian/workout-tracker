import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RequestValidationError } from '@app/errors';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({ name: z.string().min(1).max(4), count: z.number().int() });

describe('ZodValidationPipe', () => {
    it('returns the parsed value on success', () => {
        expect(new ZodValidationPipe(schema).transform({ name: 'ok', count: 1 })).toEqual({ name: 'ok', count: 1 });
    });

    it('throws a RequestValidationError keyed by field path', () => {
        const pipe = new ZodValidationPipe(schema);

        try {
            pipe.transform({ name: '', count: 'x' });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(RequestValidationError);
            const problem = (error as RequestValidationError).problem;
            expect(Object.keys(problem.errors).sort()).toEqual(['count', 'name']);
            expect(problem.status).toBe(400);
        }
    });

    it('joins a nested path with dots so the UI can show it', () => {
        const nested = z.object({ members: z.array(z.object({ name: z.string().min(1) })) });

        try {
            new ZodValidationPipe(nested).transform({ members: [{ name: '' }] });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(Object.keys((error as RequestValidationError).problem.errors)).toEqual(['members.0.name']);
        }
    });

    it('collects every message for one field rather than only the first', () => {
        const multi = z.object({
            name: z
                .string()
                .min(5)
                .regex(/^[a-z]+$/),
        });

        try {
            new ZodValidationPipe(multi).transform({ name: 'A1' });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect((error as RequestValidationError).problem.errors['name']?.length).toBeGreaterThan(1);
        }
    });
});
