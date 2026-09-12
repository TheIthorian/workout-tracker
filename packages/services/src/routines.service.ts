import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, withTransaction, type Db, type Tx } from '@app/db';
import { validateSetMeasurements, type TrackingType } from '@app/domain';
import { EntityNotFoundError, SetShapeMismatchError } from '@app/errors';
import { asc, count, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, routineExercises, routines } = schema;

export type RoutineSummary = {
    id: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
    exerciseCount: number;
    createdAt: string;
    updatedAt: string;
};

export type RoutineExerciseTargets = {
    targetSets: number;
    restSeconds: number | null;
    notes: string | null;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceM: number | null;
};

export type RoutineExercise = RoutineExerciseTargets & {
    id: string;
    position: number;
    exercise: {
        id: string;
        name: string;
        trackingType: TrackingType;
        isCatalog: boolean;
        archivedAt: string | null;
    };
};

export type RoutineDetail = RoutineSummary & { exercises: RoutineExercise[] };

/** One slot as a caller supplies it: the exercise plus its targets. Omitted targets are null. */
export type RoutineExerciseInput = { exerciseId: string; targetSets: number } & Partial<
    Omit<RoutineExerciseTargets, 'targetSets'>
>;

export type PaginatedRoutines = {
    data: RoutineSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/**
 * Routines and their ordered exercise slots.
 *
 * Every mutation resolves to the full `RoutineDetail`, so a client refreshes from one shape
 * whichever route it used. Slot positions are dense and 0-based and are renumbered here; nothing
 * else may write them.
 */
export class RoutinesService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * A page of the workspace's routines by name, each with its slot count.
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
    }): Promise<PaginatedRoutines> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(
            routines,
            workspaceId,
            search === undefined || search === '' ? undefined : ilike(routines.name, `%${search}%`),
            includeArchived === true ? undefined : isNull(routines.archivedAt),
        );

        const [data, [totals]] = await Promise.all([
            this.db
                .select(ROUTINE_SUMMARY_COLUMNS)
                .from(routines)
                .where(where)
                .orderBy(asc(routines.name), asc(routines.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(routines).where(where),
        ]);

        const totalCount = totals?.totalCount ?? 0;

        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /**
     * One routine with its ordered slots.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the routine is not in this
     * workspace — the two are deliberately indistinguishable on the wire.
     */
    async get({
        userId,
        workspaceId,
        routineId,
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        return this.loadDetail({ db: this.db, workspaceId, routineId });
    }

    /**
     * Creates an empty routine.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        description,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        description?: string | null;
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(routines)
            .values({ workspaceId, createdByUserId: userId, name, description: description ?? null })
            .returning({ id: routines.id });

        return this.loadDetail({ db: this.db, workspaceId, routineId: row.id });
    }

    /**
     * Updates a routine's own fields. Only the fields present are written.
     *
     * @param archived true archives the routine, false restores it.
     * @throws EntityNotFoundError when the caller is not a member, or the routine is not in this
     * workspace.
     */
    async update({
        userId,
        workspaceId,
        routineId,
        name,
        description,
        archived,
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
        name?: string;
        description?: string | null;
        archived?: boolean;
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        const now = new Date().toISOString();

        const [row] = await this.db
            .update(routines)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(description === undefined ? {} : { description }),
                ...(archived === undefined ? {} : { archivedAt: archived ? now : null }),
                updatedAt: now,
            })
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)))
            .returning({ id: routines.id });

        if (!row) throw new EntityNotFoundError('Routine not found');

        return this.loadDetail({ db: this.db, workspaceId, routineId });
    }

    /**
     * Appends a slot to the end of the routine.
     *
     * @throws EntityNotFoundError for a routine not in this workspace, or an exercise the workspace
     * cannot see (another tenant's, or archived).
     * @throws SetShapeMismatchError when a target does not fit the exercise's tracking type.
     */
    async addExercise({
        userId,
        workspaceId,
        routineId,
        ...input
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
    } & RoutineExerciseInput): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireRoutine({ db: tx, workspaceId, routineId });
            const trackingTypes = await this.requireAssignableExercises({
                db: tx,
                workspaceId,
                exerciseIds: [input.exerciseId],
            });
            assertTargetsFit({ trackingType: trackingTypes.get(input.exerciseId) as TrackingType, targets: input });

            const [{ next }] = await tx
                .select({ next: sql<number>`coalesce(max(${routineExercises.position}) + 1, 0)`.mapWith(Number) })
                .from(routineExercises)
                .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)));

            await tx.insert(routineExercises).values(toSlotRow({ workspaceId, routineId, position: next, input }));

            return this.loadDetail({ db: tx, workspaceId, routineId });
        });
    }

    /**
     * Updates one slot's targets. Only the fields present are written; the merged result is
     * re-checked against the exercise's tracking type.
     *
     * @throws EntityNotFoundError when the slot is not in this routine and workspace.
     * @throws SetShapeMismatchError when a target does not fit the exercise's tracking type.
     */
    async updateExercise({
        userId,
        workspaceId,
        routineId,
        routineExerciseId,
        ...patch
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
        routineExerciseId: string;
    } & Partial<RoutineExerciseTargets>): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            const [current] = await tx
                .select({
                    targetSets: routineExercises.targetSets,
                    restSeconds: routineExercises.restSeconds,
                    notes: routineExercises.notes,
                    targetReps: routineExercises.targetReps,
                    targetWeightKg: routineExercises.targetWeightKg,
                    targetDurationSeconds: routineExercises.targetDurationSeconds,
                    targetDistanceM: routineExercises.targetDistanceM,
                    trackingType: exercises.trackingType,
                })
                .from(routineExercises)
                .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
                .where(
                    scopedToWorkspace(
                        routineExercises,
                        workspaceId,
                        eq(routineExercises.routineId, routineId),
                        eq(routineExercises.id, routineExerciseId),
                    ),
                );

            if (!current) throw new EntityNotFoundError('Routine exercise not found');

            const merged: RoutineExerciseTargets = {
                targetSets: patch.targetSets ?? current.targetSets,
                restSeconds: patch.restSeconds === undefined ? current.restSeconds : patch.restSeconds,
                notes: patch.notes === undefined ? current.notes : patch.notes,
                targetReps: patch.targetReps === undefined ? current.targetReps : patch.targetReps,
                targetWeightKg: patch.targetWeightKg === undefined ? current.targetWeightKg : patch.targetWeightKg,
                targetDurationSeconds:
                    patch.targetDurationSeconds === undefined
                        ? current.targetDurationSeconds
                        : patch.targetDurationSeconds,
                targetDistanceM: patch.targetDistanceM === undefined ? current.targetDistanceM : patch.targetDistanceM,
            };
            assertTargetsFit({ trackingType: current.trackingType, targets: merged });

            await tx
                .update(routineExercises)
                .set({ ...merged, updatedAt: new Date().toISOString() })
                .where(
                    scopedToWorkspace(
                        routineExercises,
                        workspaceId,
                        eq(routineExercises.routineId, routineId),
                        eq(routineExercises.id, routineExerciseId),
                    ),
                );

            return this.loadDetail({ db: tx, workspaceId, routineId });
        });
    }

    /**
     * Removes a slot and closes the gap in the remaining positions.
     *
     * @throws EntityNotFoundError when the slot is not in this routine and workspace.
     */
    async removeExercise({
        userId,
        workspaceId,
        routineId,
        routineExerciseId,
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
        routineExerciseId: string;
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            const deleted = await tx
                .delete(routineExercises)
                .where(
                    scopedToWorkspace(
                        routineExercises,
                        workspaceId,
                        eq(routineExercises.routineId, routineId),
                        eq(routineExercises.id, routineExerciseId),
                    ),
                )
                .returning({ id: routineExercises.id });

            if (deleted.length === 0) throw new EntityNotFoundError('Routine exercise not found');

            const remaining = await tx
                .select({ id: routineExercises.id, position: routineExercises.position })
                .from(routineExercises)
                .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)))
                .orderBy(asc(routineExercises.position));

            for (const [index, slot] of remaining.entries()) {
                if (slot.position === index) continue;

                await tx
                    .update(routineExercises)
                    .set({ position: index })
                    .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.id, slot.id)));
            }

            return this.loadDetail({ db: tx, workspaceId, routineId });
        });
    }

    /**
     * Replaces the routine's whole slot list with `exercises`, in the given order, as one
     * transaction: an invalid slot anywhere leaves the old list untouched.
     *
     * @throws EntityNotFoundError for a routine not in this workspace, or any exercise the
     * workspace cannot see.
     * @throws SetShapeMismatchError when any slot's targets do not fit its exercise.
     */
    async replaceExercises({
        userId,
        workspaceId,
        routineId,
        exercises: inputs,
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
        exercises: RoutineExerciseInput[];
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireRoutine({ db: tx, workspaceId, routineId });
            const trackingTypes = await this.requireAssignableExercises({
                db: tx,
                workspaceId,
                exerciseIds: inputs.map((input) => input.exerciseId),
            });

            for (const input of inputs) {
                assertTargetsFit({ trackingType: trackingTypes.get(input.exerciseId) as TrackingType, targets: input });
            }

            await tx
                .delete(routineExercises)
                .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)));

            if (inputs.length > 0) {
                await tx
                    .insert(routineExercises)
                    .values(inputs.map((input, position) => toSlotRow({ workspaceId, routineId, position, input })));
            }

            await tx
                .update(routines)
                .set({ updatedAt: new Date().toISOString() })
                .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));

            return this.loadDetail({ db: tx, workspaceId, routineId });
        });
    }

    private async requireRoutine({
        db,
        workspaceId,
        routineId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineId: string;
    }): Promise<void> {
        const [row] = await db
            .select({ id: routines.id })
            .from(routines)
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));

        if (!row) throw new EntityNotFoundError('Routine not found');
    }

    /**
     * The tracking type of every exercise in `exerciseIds`, provided each is one the workspace can
     * see (its own or catalog) and not archived. Any miss is a not-found for the whole call.
     */
    private async requireAssignableExercises({
        db,
        workspaceId,
        exerciseIds,
    }: {
        db: Db | Tx;
        workspaceId: string;
        exerciseIds: string[];
    }): Promise<Map<string, TrackingType>> {
        const unique = [...new Set(exerciseIds)];
        if (unique.length === 0) return new Map();

        const rows = await db
            .select({ id: exercises.id, trackingType: exercises.trackingType })
            .from(exercises)
            .where(
                scopedToWorkspaceOrGlobal(
                    exercises,
                    workspaceId,
                    inArray(exercises.id, unique),
                    isNull(exercises.archivedAt),
                ),
            );

        if (rows.length !== unique.length) throw new EntityNotFoundError('Exercise not found');

        return new Map(rows.map((row) => [row.id, row.trackingType]));
    }

    private async loadDetail({
        db,
        workspaceId,
        routineId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineId: string;
    }): Promise<RoutineDetail> {
        const [routine] = await db
            .select(ROUTINE_SUMMARY_COLUMNS)
            .from(routines)
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));

        if (!routine) throw new EntityNotFoundError('Routine not found');

        // The tenant filter sits on `routine_exercises`; the joined exercise row may be catalog
        // content (null workspace), which was admitted when the slot was written.
        const slots = await db
            .select({
                id: routineExercises.id,
                position: routineExercises.position,
                targetSets: routineExercises.targetSets,
                restSeconds: routineExercises.restSeconds,
                notes: routineExercises.notes,
                targetReps: routineExercises.targetReps,
                targetWeightKg: routineExercises.targetWeightKg,
                targetDurationSeconds: routineExercises.targetDurationSeconds,
                targetDistanceM: routineExercises.targetDistanceM,
                exercise: {
                    id: exercises.id,
                    name: exercises.name,
                    trackingType: exercises.trackingType,
                    isCatalog: sql<boolean>`${exercises.workspaceId} is null`,
                    archivedAt: exercises.archivedAt,
                },
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)))
            .orderBy(asc(routineExercises.position));

        return { ...routine, exercises: slots };
    }
}

const ROUTINE_SUMMARY_COLUMNS = {
    id: routines.id,
    name: routines.name,
    description: routines.description,
    archivedAt: routines.archivedAt,
    // A join-less select strips table qualifiers from every `PgColumn` here, including this
    // subquery's own `routines.id` — ambiguous against `routine_exercises.id` and silently always
    // false. `sql.identifier` isn't a `PgColumn`, so it survives unqualified.
    exerciseCount:
        sql<number>`(select count(*) from ${routineExercises} where ${routineExercises.routineId} = ${sql.identifier('routines')}.${sql.identifier('id')})`.mapWith(
            Number,
        ),
    createdAt: routines.createdAt,
    updatedAt: routines.updatedAt,
};

/**
 * A missing target is fine — targets are suggestions — so only the `unexpected` half of the
 * domain check matters here; `missing` is what a logged set cares about.
 */
function assertTargetsFit({
    trackingType,
    targets,
}: {
    trackingType: TrackingType;
    targets: Partial<Omit<RoutineExerciseTargets, 'targetSets' | 'restSeconds' | 'notes'>>;
}): void {
    const result = validateSetMeasurements({
        trackingType,
        measurements: {
            weightKg: targets.targetWeightKg,
            reps: targets.targetReps,
            durationSeconds: targets.targetDurationSeconds,
            distanceM: targets.targetDistanceM,
        },
    });

    if (result.valid || result.unexpected.length === 0) return;

    throw new SetShapeMismatchError(
        'Targets do not match the exercise tracking type',
        `${trackingType} does not use: ${result.unexpected.join(', ')}`,
    );
}

function toSlotRow({
    workspaceId,
    routineId,
    position,
    input,
}: {
    workspaceId: string;
    routineId: string;
    position: number;
    input: RoutineExerciseInput;
}): typeof routineExercises.$inferInsert {
    return {
        workspaceId,
        routineId,
        exerciseId: input.exerciseId,
        position,
        targetSets: input.targetSets,
        restSeconds: input.restSeconds ?? null,
        notes: input.notes ?? null,
        targetReps: input.targetReps ?? null,
        targetWeightKg: input.targetWeightKg ?? null,
        targetDurationSeconds: input.targetDurationSeconds ?? null,
        targetDistanceM: input.targetDistanceM ?? null,
    };
}
