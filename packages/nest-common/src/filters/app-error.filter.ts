import { STATUS_CODES } from 'node:http';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { AppError, buildProblem, type ProblemDetails } from '@app/errors';
import type { Logger } from '@app/logger';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The problem body for an exception nothing else matched. It carries no `detail`, because an
 * unanticipated error's message is not safe to hand a client.
 */
const UNEXPECTED_ERROR_PROBLEM = buildProblem({
    errorName: 'InternalServerError',
    title: 'Unexpected error',
    status: 500,
});

/**
 * The terminal error boundary for the API. `@Catch()` with no argument means this catches
 * everything, not just `AppError`, so nothing reaches the client as an unshaped 500.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
    constructor(private readonly logger: Logger) {}

    /** Maps any thrown value to an RFC 7807 problem body. */
    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const reply = http.getResponse<FastifyReply>();
        const request = http.getRequest<FastifyRequest>();

        const problem = resolveProblem(exception);
        this.log(exception, request, problem.status);

        // This filter is the terminal `@Catch()` boundary for the whole process. A reply that
        // already flushed (a second error after headers went out, or one during streaming) would
        // throw FST_ERR_REP_ALREADY_SENT on another write - the one throw this filter must never
        // let escape. Nest's own BaseExceptionFilter guards the same way.
        if (reply.sent) return;

        reply.header('content-type', 'application/json');
        reply.status(problem.status).send(problem);
    }

    private log(exception: unknown, request: FastifyRequest, statusCode: number): void {
        const context = { err: exception, statusCode, method: request.method, url: request.url };

        if (statusCode >= 500) {
            this.logger.error(context, 'Unhandled exception returned an error response');
            return;
        }

        this.logger.warn(context, 'Request exception returned an error response');
    }
}

/** Resolves any thrown value to the problem body this filter writes, without touching the reply. */
function resolveProblem(exception: unknown): ProblemDetails {
    if (exception instanceof AppError) return exception.problem;
    if (exception instanceof HttpException) {
        const status = exception.getStatus();

        return buildProblem({
            errorName: `Http${status}Error`,
            title: STATUS_CODES[status] ?? 'Request failed',
            status,
        });
    }

    return malformedBodyProblem(exception) ?? UNEXPECTED_ERROR_PROBLEM;
}

/**
 * Fastify rejects an unparseable JSON body before any handler runs, with `err.statusCode === 400`
 * and a `FST_ERR_CTP_INVALID_JSON` code. A body that parses but fails validation surfaces as a
 * `RequestValidationError` from the zod pipe instead and never reaches here. Both `statusCode` and
 * `code` must match: a third-party error that merely happens to carry `statusCode: 400` is not a
 * JSON parse failure, and must not have its message copied into `detail`.
 */
function malformedBodyProblem(exception: unknown): ProblemDetails | null {
    if (typeof exception !== 'object' || exception === null) return null;

    const candidate = exception as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (candidate.statusCode !== 400 || candidate.code !== 'FST_ERR_CTP_INVALID_JSON') return null;

    return buildProblem({
        errorName: 'MalformedRequest',
        title: 'Malformed JSON',
        status: 400,
        detail: typeof candidate.message === 'string' ? candidate.message : undefined,
    });
}
