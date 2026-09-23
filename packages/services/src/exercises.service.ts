import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, type Db } from '@app/db';
import type { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { asc, count, desc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import { recalculateRoutineRecommendations } from './routine-recommendations.js';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exerciseGuideImages, exerciseLinks, exercisePreferences, exercises } = schema;

export type ExerciseSummary = {
    id: string;
    name: string;
    slug: string | null;
    isCatalog: boolean;
    trackingType: TrackingType;
    equipment: Equipment[];
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    notes: string | null;
    restSeconds: number | null;
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
 * The exercise library a workspace sees: the shared catalog plus its own custom exercises.
 *
 * Reads admit catalog rows; writes are scoped strictly to the workspace, so a catalog id through
 * `update` is a not-found rather than an edit of shared content.
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
     * A page of the exercises the workspace can see — catalog and custom — by name.
     *
     * @param search matches anywhere in the name, case-insensitively.
     * @param equipment when given, keeps only exercises whose required equipment is a subset of it
     * (bodyweight exercises always match, including against an empty list).
     * @param muscle when given, keeps only exercises naming it, primary or secondary.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
        search,
        includeArchived,
        equipment,
        muscle,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
        search?: string;
        includeArchived?: boolean;
        equipment?: Equipment[];
        muscle?: MuscleGroup;
    }): Promise<PaginatedExercises> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspaceOrGlobal(
            exercises,
            workspaceId,
            search === undefined || search === '' ? undefined : ilike(exercises.name, `%${search}%`),
            includeArchived === true ? undefined : isNull(exercises.archivedAt),
            equipment === undefined ? undefined : requiresOnly(equipment),
            muscle === undefined ? undefined : targetsMuscle(muscle),
        );

        const [data, [totals]] = await Promise.all([
            this.db
                .select(EXERCISE_SUMMARY_COLUMNS)
                .from(exercises)
                .leftJoin(exercisePreferences, preferencesFor(workspaceId))
                .where(where)
                .orderBy(asc(exercises.name), desc(exercises.createdAt))
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
        equipment,
        primaryMuscles,
        secondaryMuscles,
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
        equipment?: Equipment[];
        primaryMuscles?: MuscleGroup[];
        secondaryMuscles?: MuscleGroup[];
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
                equipment: equipment ?? [],
                primaryMuscles: primaryMuscles ?? [],
                secondaryMuscles: secondaryMuscles ?? [],
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
        equipment,
        primaryMuscles,
        secondaryMuscles,
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
        equipment?: Equipment[];
        primaryMuscles?: MuscleGroup[];
        secondaryMuscles?: MuscleGroup[];
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
                ...(equipment === undefined ? {} : { equipment }),
                ...(primaryMuscles === undefined ? {} : { primaryMuscles }),
                ...(secondaryMuscles === undefined ? {} : { secondaryMuscles }),
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

        if (primaryMuscles !== undefined || secondaryMuscles !== undefined) {
            await recalculateRoutineRecommendations({ db: this.db, workspaceId });
        }

        return this.loadDetail({ workspaceId, exerciseId });
    }

    /**
     * Sets the workspace's rest between sets for an exercise, catalog or custom.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not visible to
     * this workspace.
     */
    async setPreferences({
        userId,
        workspaceId,
        exerciseId,
        restSeconds,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        restSeconds: number;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        const [exercise] = await this.db
            .select({ id: exercises.id })
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!exercise) throw new EntityNotFoundError('Exercise not found');

        const now = new Date().toISOString();

        await this.db
            .insert(exercisePreferences)
            .values({ workspaceId, exerciseId, restSeconds, updatedAt: now })
            .onConflictDoUpdate({
                target: [exercisePreferences.workspaceId, exercisePreferences.exerciseId],
                set: { restSeconds, updatedAt: now },
            });

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
            .leftJoin(exercisePreferences, preferencesFor(workspaceId))
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.id, exerciseId)));

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
                    scopedToWorkspaceOrGlobal(
                        exerciseGuideImages,
                        workspaceId,
                        eq(exerciseGuideImages.exerciseId, exerciseId),
                    ),
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
                .where(scopedToWorkspaceOrGlobal(exerciseLinks, workspaceId, eq(exerciseLinks.exerciseId, exerciseId)))
                .orderBy(asc(exerciseLinks.position)),
        ]);

        return { ...exercise, images, links };
    }
}

/**
 * Admits an exercise only if everything it needs is in `available`. Bodyweight rows (`'{}'`) are a
 * subset of any list, including an empty one, so they always pass.
 *
 * The literal is built explicitly rather than passed as a bound array parameter: `node-postgres`
 * serialises a JS array bound through `sql` as a bare comma-joined scalar (e.g. `dumbbell`, or `''`
 * for an empty list), not a `{...}` array literal, so Postgres rejects the `::equipment[]` cast.
 * Values are enum members, never user text, so string-building them is safe.
 */
function requiresOnly(available: Equipment[]): SQL {
    return sql`${exercises.equipment} <@ ${`{${available.join(',')}}`}::equipment[]`;
}

/**
 * Admits an exercise that names the muscle at all, primary or secondary. Enum members are never
 * user text, so the literal is safe to build; see `requiresOnly` for why it is not bound.
 */
function targetsMuscle(muscle: MuscleGroup): SQL {
    return sql`(${exercises.primaryMuscles} || ${exercises.secondaryMuscles}) && ${`{${muscle}}`}::muscle_group[]`;
}

const EXERCISE_SUMMARY_COLUMNS = {
    id: exercises.id,
    name: exercises.name,
    slug: exercises.slug,
    isCatalog: sql<boolean>`${exercises.workspaceId} is null`,
    trackingType: exercises.trackingType,
    equipment: exercises.equipment,
    primaryMuscles: exercises.primaryMuscles,
    secondaryMuscles: exercises.secondaryMuscles,
    notes: exercises.notes,
    restSeconds: exercisePreferences.restSeconds,
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

/** The join that attaches the caller's own preference row, if any, to each exercise. */
function preferencesFor(workspaceId: string): SQL {
    return scopedToWorkspace(exercisePreferences, workspaceId, eq(exercisePreferences.exerciseId, exercises.id));
}
