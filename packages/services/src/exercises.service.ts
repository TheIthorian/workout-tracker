import { schema, scopedToWorkspace, type Db } from '@app/db';
import type { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { asc, count, desc, eq, ilike, isNull } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

export type ExerciseSummary = {
    id: string;
    name: string;
    trackingType: TrackingType;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ExerciseGuideImage = {
    id: string;
    storageKey: string;
    contentType: string;
    caption: string | null;
    position: number;
};

export type ExerciseLink = {
    id: string;
    url: string;
    label: string | null;
    position: number;
};

export type ExerciseDetail = ExerciseSummary & {
    guideSetup: string | null;
    guideExecution: string | null;
    guideCues: string | null;
    guideMistakes: string | null;
    images: ExerciseGuideImage[];
    links: ExerciseLink[];
};

export type PaginatedExercises = {
    data: ExerciseSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/**
 * The workspace's exercise library, including each exercise's how-to guide.
 *
 * Images are returned as storage keys rather than URLs: turning a key into a URL needs
 * deployment configuration, which belongs to the app, not to a package.
 */
export class ExercisesService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * A page of the workspace's exercises, newest first.
     *
     * @param search matches anywhere in the name, case-insensitively.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
        search,
        includeArchived,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
        search?: string;
        includeArchived?: boolean;
    }): Promise<PaginatedExercises> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(
            exercises,
            workspaceId,
            search === undefined || search === '' ? undefined : ilike(exercises.name, `%${search}%`),
            includeArchived === true ? undefined : isNull(exercises.archivedAt),
        );

        const [data, [totals]] = await Promise.all([
            this.db
                .select(EXERCISE_SUMMARY_COLUMNS)
                .from(exercises)
                .where(where)
                .orderBy(desc(exercises.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(exercises).where(where),
        ]);

        const totalCount = totals?.totalCount ?? 0;

        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /**
     * One exercise with its full guide, images, and links.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not in this
     * workspace — the two are deliberately indistinguishable on the wire.
     */
    async get({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        return this.loadDetail({ workspaceId, exerciseId });
    }

    /**
     * Creates an exercise in the workspace.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        trackingType,
        notes,
        guideSetup,
        guideExecution,
        guideCues,
        guideMistakes,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        trackingType: TrackingType;
        notes?: string | null;
        guideSetup?: string | null;
        guideExecution?: string | null;
        guideCues?: string | null;
        guideMistakes?: string | null;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(exercises)
            .values({
                workspaceId,
                createdByUserId: userId,
                name,
                trackingType,
                notes: notes ?? null,
                guideSetup: guideSetup ?? null,
                guideExecution: guideExecution ?? null,
                guideCues: guideCues ?? null,
                guideMistakes: guideMistakes ?? null,
            })
            .returning({ id: exercises.id });

        return this.loadDetail({ workspaceId, exerciseId: row.id });
    }

    /**
     * Updates an exercise. Only the fields present are written.
     *
     * @param archived true archives the exercise, false restores it.
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not in this
     * workspace.
     */
    async update({
        userId,
        workspaceId,
        exerciseId,
        name,
        trackingType,
        notes,
        guideSetup,
        guideExecution,
        guideCues,
        guideMistakes,
        archived,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        name?: string;
        trackingType?: TrackingType;
        notes?: string | null;
        guideSetup?: string | null;
        guideExecution?: string | null;
        guideCues?: string | null;
        guideMistakes?: string | null;
        archived?: boolean;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        const now = new Date().toISOString();

        const [row] = await this.db
            .update(exercises)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(trackingType === undefined ? {} : { trackingType }),
                ...(notes === undefined ? {} : { notes }),
                ...(guideSetup === undefined ? {} : { guideSetup }),
                ...(guideExecution === undefined ? {} : { guideExecution }),
                ...(guideCues === undefined ? {} : { guideCues }),
                ...(guideMistakes === undefined ? {} : { guideMistakes }),
                ...(archived === undefined ? {} : { archivedAt: archived ? now : null }),
                updatedAt: now,
            })
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)))
            .returning({ id: exercises.id });

        if (!row) throw new EntityNotFoundError('Exercise not found');

        return this.loadDetail({ workspaceId, exerciseId });
    }

    private async loadDetail({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<ExerciseDetail> {
        const [exercise] = await this.db
            .select(EXERCISE_DETAIL_COLUMNS)
            .from(exercises)
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!exercise) throw new EntityNotFoundError('Exercise not found');

        const [images, links] = await Promise.all([
            this.db
                .select({
                    id: exerciseGuideImages.id,
                    storageKey: exerciseGuideImages.storageKey,
                    contentType: exerciseGuideImages.contentType,
                    caption: exerciseGuideImages.caption,
                    position: exerciseGuideImages.position,
                })
                .from(exerciseGuideImages)
                .where(
                    scopedToWorkspace(exerciseGuideImages, workspaceId, eq(exerciseGuideImages.exerciseId, exerciseId)),
                )
                .orderBy(asc(exerciseGuideImages.position)),
            this.db
                .select({
                    id: exerciseLinks.id,
                    url: exerciseLinks.url,
                    label: exerciseLinks.label,
                    position: exerciseLinks.position,
                })
                .from(exerciseLinks)
                .where(scopedToWorkspace(exerciseLinks, workspaceId, eq(exerciseLinks.exerciseId, exerciseId)))
                .orderBy(asc(exerciseLinks.position)),
        ]);

        return { ...exercise, images, links };
    }
}

const EXERCISE_SUMMARY_COLUMNS = {
    id: exercises.id,
    name: exercises.name,
    trackingType: exercises.trackingType,
    notes: exercises.notes,
    archivedAt: exercises.archivedAt,
    createdAt: exercises.createdAt,
    updatedAt: exercises.updatedAt,
};

const EXERCISE_DETAIL_COLUMNS = {
    ...EXERCISE_SUMMARY_COLUMNS,
    guideSetup: exercises.guideSetup,
    guideExecution: exercises.guideExecution,
    guideCues: exercises.guideCues,
    guideMistakes: exercises.guideMistakes,
};
