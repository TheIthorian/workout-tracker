import { randomUUID } from 'node:crypto';
import { schema, withTransaction, type Db, type Tx } from '@app/db';
import { RequestValidationError } from '@app/errors';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { createLocalAccountIssuer } from 'better-auth/db';
import { AUTH_SCHEMA, buildAuthOptions, type AuthConfig } from './auth-options.js';

const { workspaces, workspaceUsers } = schema;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

/** Postgres error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** The unique constraint on `user.email` - see `packages/db/src/schema/auth.ts`. */
const USER_EMAIL_UNIQUE_CONSTRAINT = 'user_email_unique';

export type SignUpParams = {
    email: string;
    password: string;
    displayName?: string;
};

export type UserProvisioningConfig = Pick<AuthConfig, 'db' | 'secret' | 'baseUrl' | 'trustedOrigins'>;

/**
 * Creates Better Auth users, and owns the transaction any additional per-account bootstrapping
 * runs in.
 *
 * Better Auth's `databaseHooks.user.create.after` hook cannot be used for that bootstrapping:
 * `after` hooks are queued with `queueAfterTransactionHook` and only run once
 * `adapter.transaction()` has already resolved, so a row written from one is a SEPARATE transaction
 * that can fail, or never run at all if the process crashes between the two. Instead the flow is
 * inverted - {@link createUserInTransaction} calls Better Auth's own Drizzle adapter factory bound
 * to a transaction handle rather than the pooled `Db`, so its insert joins the caller's
 * transaction and a rollback from either write discards both.
 */
export class UserProvisioningService {
    private readonly db: Db;
    private readonly authConfig: Pick<AuthConfig, 'secret' | 'baseUrl' | 'trustedOrigins'>;

    constructor({ db, secret, baseUrl, trustedOrigins }: UserProvisioningConfig) {
        this.db = db;
        this.authConfig = { secret, baseUrl, trustedOrigins };
    }

    /** Creates a Better Auth user in a new transaction on this service's own `db`. */
    async createUser(params: { email: string; name: string; password?: string }): Promise<{ id: string }> {
        return withTransaction(this.db, (tx) => this.createUserInTransaction(tx, params));
    }

    /**
     * The transaction-scoped core of {@link createUser}, split out so a caller that already owns a
     * transaction can extend that SAME transaction instead of nesting a second, independent one.
     * `tx` is a per-call parameter rather than a constructor dependency because the transaction
     * genuinely varies per invocation.
     *
     * Omitting `password` produces a user with no sign-in credential — useful for inviting or
     * pre-provisioning an account that supplies one later via {@link createCredentialAccount}.
     */
    async createUserInTransaction(
        tx: Tx,
        params: { email: string; name: string; password?: string },
    ): Promise<{ id: string }> {
        const options = buildAuthOptions(this.authConfig);
        const adapter = drizzleAdapter(tx, { provider: 'pg', schema: AUTH_SCHEMA })(options);

        const created = await adapter.create<{ id: string; name: string; email: string }>({
            model: 'user',
            data: { name: params.name, email: params.email },
        });

        if (params.password !== undefined) {
            await this.createCredentialAccount(tx, { userId: created.id, password: params.password });
        }

        return { id: created.id };
    }

    /**
     * Writes the credential `account` row for a user that already exists, using the exact hasher
     * Better Auth's own `/sign-in/email` route verifies against - a user given a password this way
     * can sign in for real.
     */
    async createCredentialAccount(tx: Tx, params: { userId: string; password: string }): Promise<void> {
        const options = buildAuthOptions(this.authConfig);
        const adapter = drizzleAdapter(tx, { provider: 'pg', schema: AUTH_SCHEMA })(options);
        const passwordHash = await hashPassword(params.password);
        const now = new Date();

        // `createdAt`/`updatedAt` are supplied explicitly, mirroring what Better Auth's own
        // `internalAdapter.linkAccount` does: calling the adapter's `create()` directly, as this
        // does, bypasses that helper, and `account.updated_at` is NOT NULL with no database
        // DEFAULT, so the adapter would omit the column and Postgres would reject the null.
        //
        // `issuer` likewise has no default. `sign-in.mjs` matches the credential account by
        // `providerId === 'credential' && issuer === createLocalAccountIssuer('credential') &&
        // accountId === user.id`; using that helper rather than the literal "local:credential"
        // keeps this in lockstep if the scheme changes.
        await adapter.create({
            model: 'account',
            data: {
                userId: params.userId,
                issuer: createLocalAccountIssuer('credential'),
                providerId: 'credential',
                accountId: params.userId,
                password: passwordHash,
                createdAt: now,
                updatedAt: now,
            },
        });
    }

    /**
     * Creates a new account end to end: the user, a default workspace, and the membership making
     * them its owner — all in ONE transaction, so a half-created account (a user with no workspace
     * to see) can never persist. Add any further per-account bootstrapping inside this same
     * transaction.
     *
     * @throws RequestValidationError when the email or password is invalid, or the email is taken.
     */
    async signUp(params: SignUpParams): Promise<{ id: string; workspaceId: string }> {
        validateSignUpParams(params);

        const displayName = params.displayName?.trim() ? params.displayName.trim() : params.email;

        try {
            return await withTransaction(this.db, async (tx) => {
                const { id } = await this.createUserInTransaction(tx, {
                    email: params.email,
                    name: displayName,
                    password: params.password,
                });

                const workspaceId = randomUUID();
                await tx.insert(workspaces).values({ id: workspaceId, name: `${displayName}'s Workspace` });
                await tx.insert(workspaceUsers).values({ userId: id, workspaceId, role: 'owner' });

                return { id, workspaceId };
            });
        } catch (error) {
            if (isDuplicateEmailError(error)) {
                throw new RequestValidationError({ email: ['Email is already in use.'] });
            }
            throw error;
        }
    }
}

function validateSignUpParams(params: SignUpParams): void {
    const errors: Record<string, string[]> = {};

    if (!params.email || !params.email.trim()) {
        errors.email = ['Email is required.'];
    } else if (!EMAIL_PATTERN.test(params.email)) {
        errors.email = ['Email is not a valid email address.'];
    }

    if (!params.password) {
        errors.password = ['Password is required.'];
    } else if (params.password.length < MIN_PASSWORD_LENGTH) {
        errors.password = [`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`];
    }

    if (Object.keys(errors).length > 0) {
        throw new RequestValidationError(errors);
    }
}

/**
 * Drizzle wraps the driver's error in a `DrizzleQueryError`, with the real `pg` error (carrying
 * `code`/`constraint`) underneath as `.cause` - checked here rather than assumed, since
 * `withTransaction` does not itself unwrap it.
 */
function isDuplicateEmailError(error: unknown): boolean {
    const cause = (error as { cause?: unknown } | undefined)?.cause;
    const pgError = cause as { code?: string; constraint?: string } | undefined;
    return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === USER_EMAIL_UNIQUE_CONSTRAINT;
}
