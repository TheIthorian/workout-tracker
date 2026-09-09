import { AsyncLocalStorage } from 'async_hooks';

/** Per-request fields every log line inside that request should carry. */
export type RequestContext = {
    requestId: string;
    userId?: string;
    /** Cross-service correlation id, echoed via `X-Correlation-Id` - see the request-context middleware. */
    correlationId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` bound for the whole async subtree, so any logger created anywhere
 * inside it emits the request id without the call site passing it down.
 */
export function runWithRequestContext<T>({ context, fn }: { context: RequestContext; fn: () => T }): T {
    return storage.run(context, fn);
}

/** Returns the context for the request in flight, or undefined outside a request. */
export function getRequestContext(): RequestContext | undefined {
    return storage.getStore();
}

/**
 * Attaches the authenticated user to the request already in flight. Called once the token is
 * verified, which is after the context was opened at the edge, so it mutates rather than re-runs.
 */
export function bindRequestUser({ userId }: { userId: string }): void {
    const context = storage.getStore();

    if (context) context.userId = userId;
}
