import { backoffDelay, DEFAULT_RETRY_POLICY, isRetryableStatus, type RetryPolicy } from '@app/api-client/retry';

/** Methods that change nothing, so repeating one whose response was lost cannot double a write. */
const SAFE_METHODS = new Set(['get', 'head', 'options']);

/**
 * How long to wait before retrying a failed request, or `null` when it should fail now.
 *
 * A retryable status means no handler ran - the API or its database is still waking - so any
 * method is safe to repeat. A request with no response at all is only repeated when it is safe:
 * a POST whose reply was lost on gym wifi may already have logged the set.
 *
 * @param attempt the 1-based attempt that just failed.
 * @param status the response status, or `undefined` when no response arrived.
 */
export function retryDelayFor({
    method,
    status,
    attempt,
    policy = DEFAULT_RETRY_POLICY,
}: {
    method: string | undefined;
    status: number | undefined;
    attempt: number;
    policy?: RetryPolicy;
}): number | null {
    if (attempt >= policy.maxAttempts) return null;

    const retryable =
        status === undefined ? SAFE_METHODS.has((method ?? 'get').toLowerCase()) : isRetryableStatus(status);

    return retryable ? backoffDelay({ attempt, policy }) : null;
}
