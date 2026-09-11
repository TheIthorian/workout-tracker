import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { TrackingType } from '@app/domain';
import { WorkspaceRole } from './workspace-membership.service.js';

const { exercises, user, workspaceUsers, workspaces } = schema;

/** Inserts a Better Auth `user` row directly, bypassing sign-up. Returns its id. */
export async function seedUser(db: Db, name = 'Test User'): Promise<string> {
    const id = randomUUID();
    await db.insert(user).values({ id, name, email: `${id}@example.com`, updatedAt: new Date() });
    return id;
}

/** Inserts a workspace with `ownerId` as its owner. Returns the workspace id. */
export async function seedWorkspace(db: Db, ownerId: string, name = 'Test Workspace'): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name });
    await db.insert(workspaceUsers).values({ workspaceId: id, userId: ownerId, role: WorkspaceRole.Owner });
    return id;
}

/** Adds an existing user to an existing workspace. */
export async function seedMembership(
    db: Db,
    params: { workspaceId: string; userId: string; role?: WorkspaceRole },
): Promise<void> {
    await db.insert(workspaceUsers).values({
        workspaceId: params.workspaceId,
        userId: params.userId,
        role: params.role ?? WorkspaceRole.Member,
    });
}

/** Inserts a catalog exercise (no workspace) directly. Returns its id. */
export async function seedCatalogExercise(
    db: Db,
    params: { slug: string; name?: string; trackingType?: TrackingType },
): Promise<string> {
    const [row] = await db
        .insert(exercises)
        .values({
            workspaceId: null,
            slug: params.slug,
            name: params.name ?? params.slug,
            trackingType: params.trackingType ?? TrackingType.WeightReps,
        })
        .returning({ id: exercises.id });

    return row.id;
}
