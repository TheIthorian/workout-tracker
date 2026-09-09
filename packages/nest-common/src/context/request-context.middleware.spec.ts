import { describe, expect, it, vi, type Mock } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestContext } from '@app/logger';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, RequestContextMiddleware } from './request-context.middleware.js';

describe('RequestContextMiddleware', () => {
    it('echoes an incoming request id and correlation id unchanged', () => {
        const { request, reply, next } = makeContext({
            [REQUEST_ID_HEADER.toLowerCase()]: 'abc-123',
            [CORRELATION_ID_HEADER.toLowerCase()]: 'corr-456',
        });

        new RequestContextMiddleware().use(request, reply, next);

        expect(reply.header).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'abc-123');
        expect(reply.header).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'corr-456');
        expect(next).toHaveBeenCalledOnce();
    });

    it('generates a 32-character hex request id and correlation id when absent', () => {
        const { request, reply, next } = makeContext({});

        new RequestContextMiddleware().use(request, reply, next);

        const requestIdCall = reply.header.mock.calls.find(([name]) => name === REQUEST_ID_HEADER);
        const correlationIdCall = reply.header.mock.calls.find(([name]) => name === CORRELATION_ID_HEADER);

        expect(requestIdCall?.[1]).toMatch(/^[0-9a-f]{32}$/);
        expect(correlationIdCall?.[1]).toMatch(/^[0-9a-f]{32}$/);
        expect(next).toHaveBeenCalledOnce();
    });

    it('treats a whitespace-only id as missing', () => {
        const { request, reply, next } = makeContext({
            [REQUEST_ID_HEADER.toLowerCase()]: '   ',
        });

        new RequestContextMiddleware().use(request, reply, next);

        const requestIdCall = reply.header.mock.calls.find(([name]) => name === REQUEST_ID_HEADER);

        expect(requestIdCall?.[1]).toMatch(/^[0-9a-f]{32}$/);
        expect(next).toHaveBeenCalledOnce();
    });

    it('sets the ids on the request as well as the response', () => {
        const { request, reply, next } = makeContext({});

        new RequestContextMiddleware().use(request, reply, next);

        expect(request.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(/^[0-9a-f]{32}$/);
        expect(request.headers[CORRELATION_ID_HEADER.toLowerCase()]).toMatch(/^[0-9a-f]{32}$/);
    });

    it('binds the correlation id onto the log context seen inside the request', () => {
        const { request, reply } = makeContext({
            [REQUEST_ID_HEADER.toLowerCase()]: 'abc-123',
            [CORRELATION_ID_HEADER.toLowerCase()]: 'corr-456',
        });
        let seen: unknown;

        new RequestContextMiddleware().use(request, reply, () => {
            seen = getRequestContext();
        });

        expect(seen).toEqual({ requestId: 'abc-123', correlationId: 'corr-456' });
    });
});

function makeContext(headers: Record<string, string>): {
    request: FastifyRequest;
    reply: FastifyReply & { header: Mock<(name: string, value: string) => void> };
    next: Mock<(error?: unknown) => void>;
} {
    const request = { headers: { ...headers } } as unknown as FastifyRequest;
    const reply = { header: vi.fn((_name: string, _value: string): void => {}) } as unknown as FastifyReply & {
        header: Mock<(name: string, value: string) => void>;
    };
    const next = vi.fn((_error?: unknown): void => {});

    return { request, reply, next };
}
