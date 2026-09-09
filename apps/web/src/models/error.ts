/** An RFC 7807 problem body as the API serialises it. */
export type ProblemDetails = {
    type?: string | null;
    title?: string | null;
    status?: number | null;
    detail?: string | null;
    instance?: string | null;
    /** Present on validation failures, keyed by field name. */
    errors?: Record<string, string[]> | null;
    [key: string]: unknown;
};
