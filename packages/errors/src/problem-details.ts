/**
 * Fallback base URI for problem `type` values, used until an app overrides it at startup.
 *
 * RFC 7807 §3.1 treats `type` as an identifier clients should not dereference, so this never has to
 * resolve — but it does end up in every problem body the API serves, so set it to your own domain.
 */
export const PROBLEM_TYPE_BASE = 'https://example.com/errors';

/**
 * Module-level rather than injected. `buildProblem` runs inside every `AppError` subclass
 * constructor, deep in services that have no access to app configuration and must not read
 * `process.env` themselves; threading a config object through all of them to set one
 * deployment-wide constant would cost far more than the constant is worth.
 *
 * Set once at startup, before anything can throw.
 */
let problemTypeBase: string = PROBLEM_TYPE_BASE;

/** Overrides the base URI every problem `type` is built from. Call once, at startup. */
export function setProblemTypeBase(base: string): void {
    problemTypeBase = base.replace(/\/+$/, '');
}

/** The base URI currently in effect, for tests and diagnostics. */
export function getProblemTypeBase(): string {
    return problemTypeBase;
}

/** RFC 7807 problem details. Absent fields are omitted rather than serialised as null. */
export type ProblemDetails = {
    type: string;
    title: string;
    status: number;
    detail?: string;
};

/** A problem body carrying a field-keyed validation error dictionary. */
export type ExtendedProblemDetails = ProblemDetails & {
    errors: Record<string, string[]>;
};

/** Builds a problem body, omitting `detail` when the caller has none. */
export function buildProblem({
    errorName,
    title,
    status,
    detail,
}: {
    errorName: string;
    title: string;
    status: number;
    detail?: string;
}): ProblemDetails {
    return {
        type: `${problemTypeBase}/${errorName}`,
        title,
        status,
        ...(detail === undefined ? {} : { detail }),
    };
}
