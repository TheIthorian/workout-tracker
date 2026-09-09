import type { Db } from './client.js';

/**
 * A transaction-scoped handle. Structurally identical to `Db`, so anything that accepts `Db` also
 * accepts a `Tx` without a special-cased signature — a repository method written against `Db`
 * works unchanged whether it runs standalone or inside a caller's transaction.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `work` inside a database transaction: commits when it resolves, rolls back when it throws.
 *
 * This is a thin wrapper over Drizzle's own `db.transaction` — the value it adds is the `Tx` type,
 * an unwrapped error-propagation guarantee callers can rely on, and one place to add tracing later.
 *
 * `db.transaction` on a `Tx` (i.e. calling `withTransaction` again with an already-transactional
 * handle) participates in the same transaction rather than opening a nested one, because Drizzle's
 * node-postgres driver implements nested `.transaction()` calls as savepoints on the same client.
 * An outer rollback therefore discards inner work too: one crash-safe unit, not two.
 */
export async function withTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(tx));
}
