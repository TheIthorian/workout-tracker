import { z } from 'zod';

/** A uuid on the wire. Route parameters are validated against this before a handler runs. */
export const guidSchema = z.uuid();

/** Page-size bounds every paginated list route shares. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Parses an integer query parameter, falling back to `fallback` for anything unparseable rather
 * than failing the request — a list route should not 400 because a bookmark carries `?page=`.
 */
function intOrDefault(fallback: number, clamp: (value: number) => number): z.ZodType<number> {
    return z
        .unknown()
        .optional()
        .transform((raw) => {
            if (raw === undefined || raw === null || raw === '') return fallback;
            const parsed = Number.parseInt(String(raw), 10);
            return Number.isNaN(parsed) ? fallback : clamp(parsed);
        })
        .pipe(z.number().int());
}

/** Query parameters every paginated list route accepts. */
export const paginationQuerySchema = z.object({
    page: intOrDefault(1, (value) => Math.max(1, value)),
    pageSize: intOrDefault(DEFAULT_PAGE_SIZE, (value) => Math.max(1, Math.min(value, MAX_PAGE_SIZE))),
    orderBy: z.string().optional(),
    // Only a case-insensitive "asc" selects ascending; every other value falls through to desc.
    direction: z
        .unknown()
        .optional()
        .transform((raw) => (String(raw ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc'))
        .pipe(z.enum(['asc', 'desc'])),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** The envelope every paginated list response uses. */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(item: T) {
    return z.object({
        data: z.array(item),
        page: z.number().int(),
        pageSize: z.number().int(),
        totalCount: z.number().int(),
        totalPages: z.number().int(),
    });
}
