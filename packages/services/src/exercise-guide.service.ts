import { schema, scopedToWorkspace, type Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import { eq, max } from 'drizzle-orm';
import type { ExerciseGuideImage, ExerciseLink } from './exercises.service.js';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

/**
 * Writes to an exercise's guide attachments — its external links and its image records.
 *
 * Deliberately holds no storage client. `removeImage` returns the deleted row's storage key so the
 * caller can delete the object; keeping the side effect outside means this class can be tested
 * against a database alone.
 */
export class ExerciseGuideService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /** Appends an external link to the exercise's guide. */
    async addLink({
        userId,
        workspaceId,
        exerciseId,
        url,
        label,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        url: string;
        label?: string | null;
    }): Promise<ExerciseLink> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const position = await this.nextLinkPosition({ workspaceId, exerciseId });

        const [row] = await this.db
            .insert(exerciseLinks)
            .values({ workspaceId, exerciseId, url, label: label ?? null, position })
            .returning(LINK_COLUMNS);

        return row;
    }

    /** Updates a link. Only the fields present are written. */
    async updateLink({
        userId,
        workspaceId,
        exerciseId,
        linkId,
        url,
        label,
        position,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        linkId: string;
        url?: string;
        label?: string | null;
        position?: number;
    }): Promise<ExerciseLink> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const [row] = await this.db
            .update(exerciseLinks)
            .set({
                ...(url === undefined ? {} : { url }),
                ...(label === undefined ? {} : { label }),
                ...(position === undefined ? {} : { position }),
            })
            .where(
                scopedToWorkspace(
                    exerciseLinks,
                    workspaceId,
                    eq(exerciseLinks.id, linkId),
                    eq(exerciseLinks.exerciseId, exerciseId),
                ),
            )
            .returning(LINK_COLUMNS);

        if (!row) throw new EntityNotFoundError('Exercise link not found');

        return row;
    }

    /** Deletes a link from the exercise's guide. */
    async removeLink({
        userId,
        workspaceId,
        exerciseId,
        linkId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        linkId: string;
    }): Promise<void> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const deleted = await this.db
            .delete(exerciseLinks)
            .where(
                scopedToWorkspace(
                    exerciseLinks,
                    workspaceId,
                    eq(exerciseLinks.id, linkId),
                    eq(exerciseLinks.exerciseId, exerciseId),
                ),
            )
            .returning({ id: exerciseLinks.id });

        if (deleted.length === 0) throw new EntityNotFoundError('Exercise link not found');
    }

    /** Records an already-uploaded image against the exercise's guide. */
    async addImage({
        userId,
        workspaceId,
        exerciseId,
        storageKey,
        contentType,
        caption,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        storageKey: string;
        contentType: string;
        caption?: string | null;
    }): Promise<ExerciseGuideImage> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const position = await this.nextImagePosition({ workspaceId, exerciseId });

        const [row] = await this.db
            .insert(exerciseGuideImages)
            .values({ workspaceId, exerciseId, storageKey, contentType, caption: caption ?? null, position })
            .returning(IMAGE_COLUMNS);

        return row;
    }

    /**
     * One image record, including the storage key its bytes live under.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the image is not on this
     * exercise in this workspace.
     */
    async getImage({
        userId,
        workspaceId,
        exerciseId,
        imageId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        imageId: string;
    }): Promise<ExerciseGuideImage> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const [row] = await this.db
            .select(IMAGE_COLUMNS)
            .from(exerciseGuideImages)
            .where(
                scopedToWorkspace(
                    exerciseGuideImages,
                    workspaceId,
                    eq(exerciseGuideImages.id, imageId),
                    eq(exerciseGuideImages.exerciseId, exerciseId),
                ),
            );

        if (!row) throw new EntityNotFoundError('Exercise image not found');

        return row;
    }

    /**
     * Deletes an image record.
     *
     * @returns the storage key of the deleted row, so the caller can remove the stored object.
     */
    async removeImage({
        userId,
        workspaceId,
        exerciseId,
        imageId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        imageId: string;
    }): Promise<{ storageKey: string }> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const [deleted] = await this.db
            .delete(exerciseGuideImages)
            .where(
                scopedToWorkspace(
                    exerciseGuideImages,
                    workspaceId,
                    eq(exerciseGuideImages.id, imageId),
                    eq(exerciseGuideImages.exerciseId, exerciseId),
                ),
            )
            .returning({ storageKey: exerciseGuideImages.storageKey });

        if (!deleted) throw new EntityNotFoundError('Exercise image not found');

        return deleted;
    }

    private async requireExercise({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .select({ id: exercises.id })
            .from(exercises)
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!row) throw new EntityNotFoundError('Exercise not found');
    }

    private async nextLinkPosition({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<number> {
        const [row] = await this.db
            .select({ highest: max(exerciseLinks.position) })
            .from(exerciseLinks)
            .where(scopedToWorkspace(exerciseLinks, workspaceId, eq(exerciseLinks.exerciseId, exerciseId)));

        return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
    }

    private async nextImagePosition({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<number> {
        const [row] = await this.db
            .select({ highest: max(exerciseGuideImages.position) })
            .from(exerciseGuideImages)
            .where(scopedToWorkspace(exerciseGuideImages, workspaceId, eq(exerciseGuideImages.exerciseId, exerciseId)));

        return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
    }
}

const LINK_COLUMNS = {
    id: exerciseLinks.id,
    url: exerciseLinks.url,
    label: exerciseLinks.label,
    position: exerciseLinks.position,
};

const IMAGE_COLUMNS = {
    id: exerciseGuideImages.id,
    storageKey: exerciseGuideImages.storageKey,
    contentType: exerciseGuideImages.contentType,
    caption: exerciseGuideImages.caption,
    position: exerciseGuideImages.position,
};
