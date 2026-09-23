import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, withTransaction, type Db, type Tx } from '@app/db';
import {
    MUSCLE_RECOVERY_DAYS,
    ROUTINE_FREQUENCY_WINDOW_DAYS,
    RoutineOrder,
    estimateRoutineSeconds,
    scoreRoutineRecommendations,
    validateSetMeasurements,
    type Equipment,
    type RoutineSlotLike,
    type TrackingType,
} from '@app/domain';
import { EntityNotFoundError, SetShapeMismatchError } from '@app/errors';
import { asc, count, eq, gte, ilike, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, routineExercises, routines, sessionExercises, setEntries, workoutSessions } = schema;

export type RoutineSummary = {
    id: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
    excludedFromRecommendations: boolean;
    exerciseCount: number;
    /** Estimated seconds to work through the routine; 0 when nothing in it has a usable target. */
    estimatedDurationSeconds: number;
    /** When a workout from this routine was last completed; null when it never has been. */
    lastCompletedAt: string | null;
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
        equipment: Equipment[];
        archivedAt: string | null;
    };
};

export type RoutineDetail = RoutineSummary & { exercises: RoutineExercise[] };

/** One slot as a caller supplies it: the exercise plus its targets. Omitted targets are null. */
export type RoutineExerciseInput = { exerciseId: string; targetSets: number } & Partial<
    Omit<RoutineExerciseTargets, 'targetSets'>
>;

/** A routine as listed, with how strongly it is recommended as the next workout. */
export type RoutineListItem = RoutineSummary & {
    /** 0-100, higher is a better pick now; null when excluded, archived, or empty. */
    recommendationScore: number | null;
};

export type PaginatedRoutines = {
    data: RoutineListItem[];
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
     * A page of the workspace's routines, each with its slot count and recommendation score.
     *
     * @param search matches anywhere in the name, case-insensitively.
     * @param order by name (the default), or highest recommendation score first with unscored
     * routines after, by name.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
        search,
        includeArchived,
        order = RoutineOrder.Name,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
        search?: string;
        includeArchived?: boolean;
        order?: RoutineOrder;
    }): Promise<PaginatedRoutines> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(
            routines,
            workspaceId,
            search === undefined || search === '' ? undefined : ilike(routines.name, `%${search}%`),
            includeArchived === true ? undefined : isNull(routines.archivedAt),
        );
        const offset = (page - 1) * pageSize;
        const byName = [asc(routines.name), asc(routines.createdAt)];

        const [scores, [totals]] = await Promise.all([
            this.recommendationScores({ workspaceId }),
            this.db.select({ totalCount: count() }).from(routines).where(where),
        ]);

        // A score depends on every routine in the workspace, so recommended order can only be
        // applied once all of them are loaded; a workspace holds few enough for that to be cheap.
        const data =
            order === RoutineOrder.Recommended
                ? sortByRecommendation({
                      routines: await this.db
                          .select(ROUTINE_SUMMARY_COLUMNS)
                          .from(routines)
                          .where(where)
                          .orderBy(...byName),
                      scores,
                  }).slice(offset, offset + pageSize)
                : await this.db
                      .select(ROUTINE_SUMMARY_COLUMNS)
                      .from(routines)
                      .where(where)
                      .orderBy(...byName)
                      .limit(pageSize)
                      .offset(offset);

        const totalCount = totals?.totalCount ?? 0;
        const routineIds = data.map((routine) => routine.id);
        const [estimates, lastCompleted] = await Promise.all([
            this.estimateByRoutine({ db: this.db, workspaceId, routineIds }),
            this.lastCompletedByRoutine({ db: this.db, workspaceId, routineIds }),
        ]);

        return {
            data: data.map((routine) => ({
                ...routine,
                estimatedDurationSeconds: estimates.get(routine.id) ?? 0,
                lastCompletedAt: lastCompleted.get(routine.id) ?? null,
                recommendationScore: scores.get(routine.id) ?? null,
            })),
            page,
            pageSize,
            totalCount,
            totalPages: Math.ceil(totalCount / pageSize),
        };
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
     * @param excludedFromRecommendations true keeps the routine out of recommendations.
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
        excludedFromRecommendations,
    }: {
        userId: string;
        workspaceId: string;
        routineId: string;
        name?: string;
        description?: string | null;
        archived?: boolean;
        excludedFromRecommendations?: boolean;
    }): Promise<RoutineDetail> {
        await this.membership.require({ userId, workspaceId });

        const now = new Date().toISOString();

        const [row] = await this.db
            .update(routines)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(description === undefined ? {} : { description }),
                ...(archived === undefined ? {} : { archivedAt: archived ? now : null }),
                ...(excludedFromRecommendations === undefined ? {} : { excludedFromRecommendations }),
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

            const current = await tx
                .select({ exerciseId: routineExercises.exerciseId })
                .from(routineExercises)
                .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)));

            // A slot the routine already has must survive its exercise being archived later, or
            // the routine can never be reordered or re-saved again once any slot's exercise is
            // retired from the catalog.
            const trackingTypes = await this.requireAssignableExercises({
                db: tx,
                workspaceId,
                exerciseIds: inputs.map((input) => input.exerciseId),
                allowArchivedIds: current.map((slot) => slot.exerciseId),
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
        allowArchivedIds = [],
    }: {
        db: Db | Tx;
        workspaceId: string;
        exerciseIds: string[];
        /** Ids admitted even if archived — the routine's own current slots, so they survive the exercise retiring. */
        allowArchivedIds?: string[];
    }): Promise<Map<string, TrackingType>> {
        const unique = [...new Set(exerciseIds)];
        if (unique.length === 0) return new Map();

        const uniqueAllowArchived = [...new Set(allowArchivedIds)];
        // `inArray` with an empty array is invalid in Drizzle, so only add the archived branch
        // when there is something to allow.
        const notArchived =
            uniqueAllowArchived.length === 0
                ? isNull(exercises.archivedAt)
                : or(isNull(exercises.archivedAt), inArray(exercises.id, uniqueAllowArchived));

        const rows = await db
            .select({ id: exercises.id, trackingType: exercises.trackingType })
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, inArray(exercises.id, unique), notArchived));

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
                    equipment: exercises.equipment,
                    archivedAt: exercises.archivedAt,
                },
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)))
            .orderBy(asc(routineExercises.position));

        const lastCompleted = await this.lastCompletedByRoutine({ db, workspaceId, routineIds: [routineId] });

        return {
            ...routine,
            estimatedDurationSeconds: estimateRoutineSeconds(slots.map(toSlotLike)),
            lastCompletedAt: lastCompleted.get(routineId) ?? null,
            exercises: slots,
        };
    }

    /**
     * Every active routine's recommendation score, from what each trains, how rested those muscles
     * are, and how often each routine was done lately. Archived routines are absent.
     */
    private async recommendationScores({ workspaceId }: { workspaceId: string }): Promise<Map<string, number | null>> {
        const now = new Date();
        const recoverySince = new Date(now.getTime() - MUSCLE_RECOVERY_DAYS * MS_PER_DAY).toISOString();
        const frequencySince = new Date(now.getTime() - ROUTINE_FREQUENCY_WINDOW_DAYS * MS_PER_DAY).toISOString();

        const [active, slots, completions, history] = await Promise.all([
            this.db
                .select({ id: routines.id, excludedFromRecommendations: routines.excludedFromRecommendations })
                .from(routines)
                .where(scopedToWorkspace(routines, workspaceId, isNull(routines.archivedAt))),
            // The tenant filter sits on `routine_exercises`; the joined exercise may be catalog content.
            this.db
                .select({
                    routineId: routineExercises.routineId,
                    primaryMuscles: exercises.primaryMuscles,
                    secondaryMuscles: exercises.secondaryMuscles,
                })
                .from(routineExercises)
                .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
                .where(scopedToWorkspace(routineExercises, workspaceId)),
            this.db
                .select({ routineId: workoutSessions.routineId, completions: count() })
                .from(workoutSessions)
                .where(
                    scopedToWorkspace(
                        workoutSessions,
                        workspaceId,
                        isNotNull(workoutSessions.routineId),
                        gte(workoutSessions.completedAt, frequencySince),
                    ),
                )
                .groupBy(workoutSessions.routineId),
            // Only exercises with a working set logged count as training the muscle; a warm-up, or
            // an exercise added and skipped, leaves it rested.
            this.db
                .selectDistinct({
                    primaryMuscles: exercises.primaryMuscles,
                    secondaryMuscles: exercises.secondaryMuscles,
                    completedAt: workoutSessions.completedAt,
                })
                .from(sessionExercises)
                .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
                .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
                .innerJoin(
                    setEntries,
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.sessionExerciseId, sessionExercises.id),
                        eq(setEntries.isWarmup, false),
                    ),
                )
                .where(
                    scopedToWorkspace(sessionExercises, workspaceId, gte(workoutSessions.completedAt, recoverySince)),
                ),
        ]);

        const slotsByRoutine = new Map<string, typeof slots>();
        for (const slot of slots) {
            slotsByRoutine.set(slot.routineId, [...(slotsByRoutine.get(slot.routineId) ?? []), slot]);
        }

        const completionsByRoutine = new Map(completions.map((row) => [row.routineId, row.completions]));

        return scoreRoutineRecommendations({
            candidates: active.map((routine) => {
                const routineSlots = slotsByRoutine.get(routine.id) ?? [];

                return {
                    id: routine.id,
                    excludedFromRecommendations: routine.excludedFromRecommendations,
                    exerciseCount: routineSlots.length,
                    primaryMuscles: routineSlots.flatMap((slot) => slot.primaryMuscles),
                    secondaryMuscles: routineSlots.flatMap((slot) => slot.secondaryMuscles),
                    recentCompletions: completionsByRoutine.get(routine.id) ?? 0,
                };
            }),
            history: history.flatMap((row) =>
                row.completedAt === null ? [] : [{ ...row, completedAt: new Date(row.completedAt) }],
            ),
            now,
        });
    }

    /**
     * The most recent completion of a workout started from each of `routineIds`, in one query
     * rather than one per routine. Routines never completed are absent from the map.
     */
    private async lastCompletedByRoutine({
        db,
        workspaceId,
        routineIds,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineIds: string[];
    }): Promise<Map<string, string>> {
        if (routineIds.length === 0) return new Map();

        const rows = await db
            .select({ routineId: workoutSessions.routineId, lastCompletedAt: max(workoutSessions.completedAt) })
            .from(workoutSessions)
            .where(
                scopedToWorkspace(
                    workoutSessions,
                    workspaceId,
                    inArray(workoutSessions.routineId, routineIds),
                    isNotNull(workoutSessions.completedAt),
                ),
            )
            .groupBy(workoutSessions.routineId);

        const byRoutine = new Map<string, string>();
        for (const row of rows) {
            if (row.routineId !== null && row.lastCompletedAt !== null)
                byRoutine.set(row.routineId, row.lastCompletedAt);
        }

        return byRoutine;
    }

    /** Estimated seconds for each of `routineIds`, in one query rather than one per routine. */
    private async estimateByRoutine({
        db,
        workspaceId,
        routineIds,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineIds: string[];
    }): Promise<Map<string, number>> {
        if (routineIds.length === 0) return new Map();

        const rows = await db
            .select({
                routineId: routineExercises.routineId,
                targetSets: routineExercises.targetSets,
                restSeconds: routineExercises.restSeconds,
                targetReps: routineExercises.targetReps,
                targetDurationSeconds: routineExercises.targetDurationSeconds,
                trackingType: exercises.trackingType,
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId, inArray(routineExercises.routineId, routineIds)));

        const slotsByRoutine = new Map<string, RoutineSlotLike[]>();
        for (const row of rows) {
            const slots = slotsByRoutine.get(row.routineId) ?? [];
            slots.push(row);
            slotsByRoutine.set(row.routineId, slots);
        }

        return new Map([...slotsByRoutine].map(([id, slots]) => [id, estimateRoutineSeconds(slots)]));
    }
}

/**
 * Highest score first; routines with no score keep their incoming (name) order after the rest,
 * as do routines that tie.
 */
function sortByRecommendation<T extends { id: string }>({
    routines: rows,
    scores,
}: {
    routines: T[];
    scores: Map<string, number | null>;
}): T[] {
    const scoreOf = (row: T): number => scores.get(row.id) ?? -1;

    return [...rows].sort((a, b) => scoreOf(b) - scoreOf(a));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A detail slot reduced to the flat shape the shared estimator reads. */
function toSlotLike(slot: {
    targetSets: number;
    restSeconds: number | null;
    targetReps: number | null;
    targetDurationSeconds: number | null;
    exercise: { trackingType: TrackingType };
}): RoutineSlotLike {
    return {
        trackingType: slot.exercise.trackingType,
        targetSets: slot.targetSets,
        targetReps: slot.targetReps,
        targetDurationSeconds: slot.targetDurationSeconds,
        restSeconds: slot.restSeconds,
    };
}

const ROUTINE_SUMMARY_COLUMNS = {
    id: routines.id,
    name: routines.name,
    description: routines.description,
    archivedAt: routines.archivedAt,
    excludedFromRecommendations: routines.excludedFromRecommendations,
    // The comparison must stay inside a nested `SQL` so the single-table rewrite (which strips
    // top-level `PgColumn` qualifiers) does not strip `routines.id`'s.
    exerciseCount: sql<number>`(select count(*) from ${routineExercises} where ${eq(
        routineExercises.routineId,
        routines.id,
    )})`.mapWith(Number),
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
