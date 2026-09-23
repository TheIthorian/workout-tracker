/** How often, and how patiently, a request is retried while the API is unreachable. */
export type RetryPolicy = {
    /** Attempts in total, including the first. `1` disables retrying. */
    maxAttempts: number;
    /** Delay before the second attempt; each later delay doubles the previous one. */
    initialDelayMs: number;
    /** Upper bound on a single delay, so the doubling cannot run away. */
    maxDelayMs: number;
};

/**
 * Spends about 7.5s across four backoffs, which covers a scale-to-zero cold start - of the API, or
 * of the database it wakes on its first query - while staying inside the time an MCP client will
 * wait for a tool result.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 8_000,
};

/**
 * Statuses that mean no handler ran: an edge proxy with nothing listening behind it yet, or the
 * API's own 503 from an auth guard whose store has not woken. The app's own 500 is deliberately
 * absent: that one means the request WAS handled, and repeating it would only ask a running server
 * to fail the same way again.
 */
enum RetryableStatus {
    RequestTimeout = 408,
    BadGateway = 502,
    ServiceUnavailable = 503,
    GatewayTimeout = 504,
}

/** Whether a response status says the API is still waking rather than that it answered. */
export function isRetryableStatus(status: number): boolean {
    // A numeric enum carries a reverse mapping, so its own values are exactly its numeric keys.
    return status in RetryableStatus;
}

/** The delay owed after `attempt` (1-based), doubling each time and clamped to the policy's ceiling. */
export function backoffDelay({ attempt, policy }: { attempt: number; policy: RetryPolicy }): number {
    return Math.min(policy.initialDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}
