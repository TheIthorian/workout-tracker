import { AppError, type ProblemDetails } from '@app/errors';

/** What the API's exception filter writes. Every field is optional on the wire. */
export type ProblemBody = Partial<ProblemDetails> & Record<string, unknown>;

/**
 * Rebuilds an `AppError` from the problem body the API serialised, carrying that body through
 * UNCHANGED rather than mapping the status onto one of the `AppError` subclasses.
 *
 * The subclasses each build their own problem in their constructor - their own `type`, `title` and
 * `errorName` - so reconstructing one would replace the API's body with a locally invented one that
 * merely resembles it. That matters because MCP tools catch `AppError` and return `error.problem`
 * to the client AS the tool result: the body is the wire contract, not a diagnostic. `AppError` is
 * concrete and takes the problem as a constructor argument, so the round trip is exact.
 *
 * "Unchanged" includes fields `ProblemDetails` doesn't know about: `RequestValidationError`
 * (`packages/errors/src/app-error.ts`) puts a field-keyed `errors` dict on its problem, thrown by
 * the zod validation pipe on every bad POST/PATCH body, and `AppErrorFilter` serialises that
 * `errors` field verbatim. Dropping it here would silently strip field-level validation detail from
 * every one of those responses. So `body` is spread through first and only the fields
 * `ProblemDetails` requires are normalised on top, for the case where the API omitted one or sent a
 * non-string value - everything else the API sent, known field or not, survives untouched.
 *
 * A 5xx deliberately throws a plain `Error` instead of an `AppError`: an API outage is not an
 * application error. That does not mean it always reaches the client as `isError: true`, though -
 * `runToolCaught`'s catch-all (`apps/mcp/src/mcp/tool-execution.ts`) turns ANY thrown error,
 * `AppError` or not, into a synthesised 500 problem body returned as a SUCCESSFUL result. The type
 * distinction this function draws still matters - it is what stops an outage being silently
 * reported as if the API had actually validated the request - the point is only that this file does
 * not decide the final wire shape.
 */
export function toAppError({ status, body }: { status: number; body: ProblemBody }): AppError {
    if (status >= 500) {
        throw new Error(`Unexpected ${status} from the API: ${String(body.title ?? 'no title')}`);
    }

    const problem: ProblemDetails = {
        ...body,
        type: typeof body.type === 'string' ? body.type : 'about:blank',
        title: typeof body.title === 'string' ? body.title : `Request failed with status ${status}`,
        status,
    };

    return new AppError(problem.title, problem);
}
