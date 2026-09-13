import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { EntityNotFoundError, ForbiddenActionError, PROBLEM_TYPE_BASE, RequestValidationError } from '@app/errors';
import type { Logger } from '@app/logger';
import { AppErrorFilter } from './app-error.filter.js';

describe('AppErrorFilter', () => {
    it('serialises an AppError as its problem body with the problem status', () => {
        const { filter, host, reply } = makeFilter();

        filter.catch(new EntityNotFoundError('Exercise not found'), host);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(reply.header).toHaveBeenCalledWith('content-type', 'application/json');
        expect(reply.send).toHaveBeenCalledWith({
            type: `${PROBLEM_TYPE_BASE}/EntityNotFoundError`,
            title: 'Exercise not found',
            status: 404,
        });
    });

    it('keeps the errors dictionary on a validation problem', () => {
        const { filter, host, reply } = makeFilter();

        filter.catch(new RequestValidationError({ name: ['Name is required'] }), host);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ errors: { name: ['Name is required'] } }));
    });

    it('returns a problem body for an unknown throw and never leaks its message', () => {
        const { filter, host, reply } = makeFilter();

        filter.catch(new Error('pool exhausted at postgres://user:pw@host/db'), host);

        expect(reply.status).toHaveBeenCalledWith(500);
        expect(reply.send).toHaveBeenCalledWith({
            type: `${PROBLEM_TYPE_BASE}/InternalServerError`,
            title: 'Unexpected error',
            status: 500,
        });
        // Ruling 6: a 500 is by definition unanticipated, so its message is as likely to carry a
        // connection string as anything useful. `detail` stays absent.
        expect(JSON.stringify(reply.send.mock.calls)).not.toContain('postgres://');
    });

    it('logs a 5xx at error with the error attached', () => {
        const { filter, host, calls } = makeFilter();

        filter.catch(new Error('pool exhausted'), host);

        expect(calls.error).toHaveLength(1);
        expect(calls.warn).toHaveLength(0);
    });

    it('logs a 4xx at warn', () => {
        const { filter, host, calls } = makeFilter();

        filter.catch(new ForbiddenActionError('Nope'), host);

        expect(calls.error).toHaveLength(0);
        expect(calls.warn).toHaveLength(1);
    });

    // Finding 1 (fix round 1): this filter is the terminal `@Catch()` boundary for the whole
    // process. If a reply already flushed (a second error after headers went out, or one during
    // streaming), writing to it again throws FST_ERR_REP_ALREADY_SENT from inside the filter
    // itself - the one place in the stack that must never throw. It must log and return instead.
    it('does not write to a reply that has already been sent, but still logs', () => {
        const { filter, host, reply, calls } = makeFilter({ sent: true });

        expect(() => filter.catch(new Error('boom'), host)).not.toThrow();

        expect(reply.send).not.toHaveBeenCalled();
        expect(reply.status).not.toHaveBeenCalled();
        expect(calls.error).toHaveLength(1);
    });

    it('writes normally when the reply has not been sent', () => {
        const { filter, host, reply } = makeFilter({ sent: false });

        filter.catch(new EntityNotFoundError('Exercise not found'), host);

        expect(reply.status).toHaveBeenCalledWith(404);
    });

    // Finding 2 (fix round 1): the plan's own sample code matched ANY thrown object with
    // `statusCode === 400` as a Fastify JSON-parse error, so a third-party error that happens to
    // carry a `statusCode: 400` property has its message copied into `detail` and handed to the
    // client - the same leak ruling 6 closed for 500s, reopened for 400s.
    it('treats a genuine Fastify JSON-parse error as MalformedRequest, with detail', () => {
        const { filter, host, reply } = makeFilter();

        filter.catch({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON', message: 'Unexpected token' }, host);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith({
            type: `${PROBLEM_TYPE_BASE}/MalformedRequest`,
            title: 'Malformed JSON',
            status: 400,
            detail: 'Unexpected token',
        });
    });

    it('does not misclassify a plain 400-carrying error as malformed JSON, and drops its message', () => {
        const { filter, host, reply } = makeFilter();

        filter.catch({ statusCode: 400, message: 'secret at postgres://user:pw@host/db' }, host);

        expect(reply.status).toHaveBeenCalledWith(500);
        expect(reply.send).toHaveBeenCalledWith({
            type: `${PROBLEM_TYPE_BASE}/InternalServerError`,
            title: 'Unexpected error',
            status: 500,
        });
        expect(JSON.stringify(reply.send.mock.calls)).not.toContain('postgres://');
    });
});

type Calls = { error: unknown[][]; warn: unknown[][] };

function makeFilter(options: { sent?: boolean } = {}): {
    filter: AppErrorFilter;
    host: ArgumentsHost;
    reply: {
        header: ReturnType<typeof vi.fn>;
        status: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        sent: boolean;
    };
    calls: Calls;
} {
    const calls: Calls = { error: [], warn: [] };
    const logger = {
        error: vi.fn((...args: unknown[]) => calls.error.push(args)),
        warn: vi.fn((...args: unknown[]) => calls.warn.push(args)),
        child: (): unknown => logger,
    } as unknown as Logger;

    const send = vi.fn();
    const header = vi.fn();
    const reply = { header, status: vi.fn(() => ({ send, header })), send, sent: options.sent ?? false };
    const host = {
        switchToHttp: () => ({
            getResponse: () => reply,
            getRequest: () => ({ method: 'GET', url: '/api/v1/exercises' }),
        }),
    } as unknown as ArgumentsHost;

    return { filter: new AppErrorFilter(logger), host, reply, calls };
}
