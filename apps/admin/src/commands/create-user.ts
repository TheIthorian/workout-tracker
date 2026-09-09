import { UserProvisioningService } from '@app/auth';
import type { Db } from '@app/db';

export type CreateUserParams = {
    email: string;
    password: string;
    displayName?: string;
};

export type CreateUserResult = {
    id: string;
    workspaceId: string;
    email: string;
};

/**
 * Creates a user with a working password and their default workspace, through the same service the
 * public sign-up route uses.
 *
 * Going through `UserProvisioningService` rather than inserting rows directly is what makes the
 * account genuinely usable: the credential is hashed with the exact function Better Auth's sign-in
 * verifies against, and the workspace and owner membership are written in the same transaction.
 * A hand-inserted `user` row produces an account that exists and cannot sign in.
 *
 * This is the seed-the-first-admin command - it bypasses nothing that sign-up would enforce, and
 * the same email and password rules apply.
 *
 * @throws RequestValidationError when the email is malformed or taken, or the password is shorter
 * than the minimum sign-up enforces.
 */
export async function createUser({
    db,
    authConfig,
    params,
}: {
    db: Db;
    authConfig: { secret: string; baseUrl: string };
    params: CreateUserParams;
}): Promise<CreateUserResult> {
    const userProvisioning = new UserProvisioningService({ db, ...authConfig });

    const { id, workspaceId } = await userProvisioning.signUp({
        email: params.email,
        password: params.password,
        ...(params.displayName === undefined ? {} : { displayName: params.displayName }),
    });

    return { id, workspaceId, email: params.email };
}

/** Renders {@link createUser}'s result for the CLI. Never echoes the password. */
export function formatCreatedUser(result: CreateUserResult): string[] {
    return [`Created user ${result.email}`, `  id:          ${result.id}`, `  workspaceId: ${result.workspaceId}`];
}
