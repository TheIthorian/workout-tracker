import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

describe('guidSchema', () => {
    it('accepts a uuid', () => {
        expect(guidSchema.parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    });

    it('rejects a non-uuid', () => {
        expect(guidSchema.safeParse('not-a-guid').success).toBe(false);
    });
});

describe('paginationQuerySchema', () => {
    it('applies the defaults for an empty query', () => {
        expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, direction: 'desc' });
    });

    it('clamps page to a floor of 1 and pageSize to the 100 ceiling', () => {
        expect(paginationQuerySchema.parse({ page: '-5', pageSize: '5000' })).toMatchObject({ page: 1, pageSize: 100 });
    });

    it('treats an unparseable number as the default rather than an error', () => {
        expect(paginationQuerySchema.parse({ page: 'abc', pageSize: 'abc' })).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('only recognises "asc" case-insensitively, everything else is desc', () => {
        expect(paginationQuerySchema.parse({ direction: 'ASC' }).direction).toBe('asc');
        expect(paginationQuerySchema.parse({ direction: 'sideways' }).direction).toBe('desc');
    });

    it('passes orderBy through', () => {
        expect(paginationQuerySchema.parse({ orderBy: 'name' }).orderBy).toBe('name');
    });
});

describe('paginatedResponseSchema', () => {
    it('wraps an item schema in the pagination envelope', () => {
        const schema = paginatedResponseSchema(z.object({ id: z.string() }));

        expect(schema.parse({ data: [{ id: 'a' }], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })).toEqual({
            data: [{ id: 'a' }],
            page: 1,
            pageSize: 20,
            totalCount: 1,
            totalPages: 1,
        });
    });
});
