import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, withTransaction, type Db, type Tx } from '@app/db';
import {
    computeSessionState,
    SessionExerciseSource,
    validateSetMeasurements,
    type SetMeasurements,
    type TrackingType,
} from '@app/domain';
import {
    ActiveSessionExistsError,
    EntityNotFoundError,
    InvalidOperationError,
    SetShapeMismatchError,
} from '@app/errors';
import { asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, routineExercises, routines, sessionExercises, setEntries, workoutSessions } = schema;
const ACTIVE_SESSION_INDEX = 'workout_sessions_active_uidx';

export type SessionSummary = {
    id: string;
    name: string;
    routineId: string | null;
    startedAt: string;
    completedAt: string | null;
    notes: string | null;
    exerciseCount: number;
    setCount: number;
    createdAt: string;
    updatedAt: string;
};
export type SessionExerciseTargets = {
    targetSets: number;
    restSeconds: number | null;
    notes: string | null;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceM: number | null;
};
export type SessionSet = {
    id: string;
    setIndex: number;
    completedAt: string;
    isWarmup: boolean;
    rpe: number | null;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
};
export type SessionExercise = SessionExerciseTargets & {
    id: string;
    position: number;
    source: SessionExerciseSource;
    trackingType: TrackingType;
    skippedAt: string | null;
    exercise: { id: string; name: string; isCatalog: boolean; archivedAt: string | null };
    sets: SessionSet[];
};
export type SessionDetail = SessionSummary & {
    exercises: SessionExercise[];
    state: ReturnType<typeof computeSessionState>;
};
export type SessionExerciseInput = { exerciseId: string; targetSets: number } & Partial<
    Omit<SessionExerciseTargets, 'targetSets'>
>;
export type SetInput = { isWarmup?: boolean; rpe?: number | null } & SetMeasurements;
export type PaginatedSessions = {
    data: SessionSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/** Owns the session aggregate: snapshot creation, session editing, set logging, and completion. */
export class WorkoutSessionsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /** Lists sessions newest first. */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
    }): Promise<PaginatedSessions> {
        await this.membership.require({ userId, workspaceId });
        const where = scopedToWorkspace(workoutSessions, workspaceId);
        const [data, [totals]] = await Promise.all([
            this.db
                .select(SUMMARY_COLUMNS)
                .from(workoutSessions)
                .where(where)
                .orderBy(desc(workoutSessions.startedAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(workoutSessions).where(where),
        ]);
        const totalCount = totals?.totalCount ?? 0;
        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /** Gets the currently active session, if present. */
    async getActive({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<SessionDetail | null> {
        await this.membership.require({ userId, workspaceId });
        const [session] = await this.db
            .select({ id: workoutSessions.id })
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, isNull(workoutSessions.completedAt)));
        return session === undefined ? null : this.loadDetail({ db: this.db, workspaceId, sessionId: session.id });
    }

    /** Gets one session in the workspace. */
    async get({
        userId,
        workspaceId,
        sessionId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return this.loadDetail({ db: this.db, workspaceId, sessionId });
    }

    /** Starts a blank session or snapshots a routine into an active session. */
    async start({
        userId,
        workspaceId,
        routineId,
        name,
    }: {
        userId: string;
        workspaceId: string;
        routineId?: string | null;
        name?: string | null;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        try {
            return await withTransaction(this.db, async (tx) => {
                const [active] = await tx
                    .select({ id: workoutSessions.id })
                    .from(workoutSessions)
                    .where(scopedToWorkspace(workoutSessions, workspaceId, isNull(workoutSessions.completedAt)));
                if (active !== undefined) throw new ActiveSessionExistsError();
                const routine =
                    routineId === undefined || routineId === null
                        ? null
                        : await this.loadRoutine({ db: tx, workspaceId, routineId });
                const [created] = await tx
                    .insert(workoutSessions)
                    .values({
                        workspaceId,
                        userId,
                        routineId: routine?.id ?? null,
                        name: name ?? routine?.name ?? 'Workout',
                    })
                    .returning({ id: workoutSessions.id });
                if (routine !== null && routine.slots.length > 0) {
                    await tx.insert(sessionExercises).values(
                        routine.slots.map((slot, position) => ({
                            workspaceId,
                            sessionId: created.id,
                            position,
                            source: SessionExerciseSource.FromRoutine,
                            ...slot,
                        })),
                    );
                }
                return this.loadDetail({ db: tx, workspaceId, sessionId: created.id });
            });
        } catch (error) {
            if (isActiveSessionViolation(error)) throw new ActiveSessionExistsError();
            throw error;
        }
    }

    /** Completes an active session that includes at least one working set. */
    async complete({
        userId,
        workspaceId,
        sessionId,
        notes,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        notes?: string | null;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, active: true });
            const [working] = await tx
                .select({ id: setEntries.id })
                .from(setEntries)
                .innerJoin(sessionExercises, eq(sessionExercises.id, setEntries.sessionExerciseId))
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(sessionExercises.sessionId, sessionId),
                        eq(setEntries.isWarmup, false),
                    ),
                )
                .limit(1);
            if (working === undefined)
                throw new InvalidOperationError('A session needs a working set before completion');
            await tx
                .update(workoutSessions)
                .set({
                    completedAt: new Date().toISOString(),
                    ...(notes === undefined ? {} : { notes }),
                    updatedAt: new Date().toISOString(),
                })
                .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Permanently abandons an active session. */
    async abandon({
        userId,
        workspaceId,
        sessionId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });
        const deleted = await this.db
            .delete(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)))
            .returning({ id: workoutSessions.id });
        if (deleted.length === 0) throw new EntityNotFoundError('Session not found');
    }

    /** Appends an assignable exercise to an active session. */
    async addExercise({
        userId,
        workspaceId,
        sessionId,
        ...input
    }: { userId: string; workspaceId: string; sessionId: string } & SessionExerciseInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, active: true });
            const exercise = await this.requireAssignableExercise({
                db: tx,
                workspaceId,
                exerciseId: input.exerciseId,
            });
            assertTargetsFit({ trackingType: exercise.trackingType, targets: input });
            const [{ next }] = await tx
                .select({ next: sql<number>`coalesce(max(${sessionExercises.position}) + 1, 0)`.mapWith(Number) })
                .from(sessionExercises)
                .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)));
            await tx.insert(sessionExercises).values({
                workspaceId,
                sessionId,
                exerciseId: input.exerciseId,
                trackingType: exercise.trackingType,
                source: SessionExerciseSource.AddedAdHoc,
                position: next,
                ...targetsToRow(input),
            });
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Updates an active session exercise's snapshotted targets or skipped state. */
    async updateExercise({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        skipped,
        ...patch
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        skipped?: boolean;
    } & Partial<SessionExerciseTargets>): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, active: true });
            const current = await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId });
            const merged: SessionExerciseTargets = {
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
                .update(sessionExercises)
                .set({
                    ...merged,
                    ...(skipped === undefined ? {} : { skippedAt: skipped ? new Date().toISOString() : null }),
                    updatedAt: new Date().toISOString(),
                })
                .where(
                    scopedToWorkspace(
                        sessionExercises,
                        workspaceId,
                        eq(sessionExercises.id, sessionExerciseId),
                        eq(sessionExercises.sessionId, sessionId),
                    ),
                );
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Reorders every exercise in an active session. */
    async reorderExercises({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseIds,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseIds: string[];
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, active: true });
            const current = await tx
                .select({ id: sessionExercises.id })
                .from(sessionExercises)
                .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)));
            if (
                current.length !== sessionExerciseIds.length ||
                current.some((row) => !sessionExerciseIds.includes(row.id))
            )
                throw new InvalidOperationError('Order must contain every session exercise exactly once');
            for (const [position, id] of sessionExerciseIds.entries())
                await tx
                    .update(sessionExercises)
                    .set({ position, updatedAt: new Date().toISOString() })
                    .where(
                        scopedToWorkspace(
                            sessionExercises,
                            workspaceId,
                            eq(sessionExercises.id, id),
                            eq(sessionExercises.sessionId, sessionId),
                        ),
                    );
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Logs the next set for an active session exercise. */
    async logSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        isWarmup,
        rpe,
        ...measurements
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
    } & SetInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, active: true });
            const exercise = await this.requireSessionExercise({
                db: tx,
                workspaceId,
                sessionId,
                sessionExerciseId,
                lock: true,
            });
            assertSetFits({ trackingType: exercise.trackingType, measurements });
            const [{ next }] = await tx
                .select({ next: sql<number>`coalesce(max(${setEntries.setIndex}) + 1, 1)`.mapWith(Number) })
                .from(setEntries)
                .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.sessionExerciseId, sessionExerciseId)));
            await tx.insert(setEntries).values({
                workspaceId,
                sessionExerciseId,
                setIndex: next,
                isWarmup: isWarmup ?? false,
                rpe: rpe ?? null,
                weightKg: measurements.weightKg ?? null,
                reps: measurements.reps ?? null,
                durationSeconds: measurements.durationSeconds ?? null,
                distanceM: measurements.distanceM ?? null,
            });
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Corrects a logged set, including after session completion. */
    async updateSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        setId,
        isWarmup,
        rpe,
        ...patch
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        setId: string;
    } & SetInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            const exercise = await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId });
            const [current] = await tx
                .select({
                    weightKg: setEntries.weightKg,
                    reps: setEntries.reps,
                    durationSeconds: setEntries.durationSeconds,
                    distanceM: setEntries.distanceM,
                })
                .from(setEntries)
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.id, setId),
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                    ),
                );
            if (current === undefined) throw new EntityNotFoundError('Set not found');
            const measurements: SetMeasurements = {
                weightKg: patch.weightKg === undefined ? current.weightKg : patch.weightKg,
                reps: patch.reps === undefined ? current.reps : patch.reps,
                durationSeconds: patch.durationSeconds === undefined ? current.durationSeconds : patch.durationSeconds,
                distanceM: patch.distanceM === undefined ? current.distanceM : patch.distanceM,
            };
            assertSetFits({ trackingType: exercise.trackingType, measurements });
            await tx
                .update(setEntries)
                .set({
                    ...measurements,
                    ...(isWarmup === undefined ? {} : { isWarmup }),
                    ...(rpe === undefined ? {} : { rpe }),
                    updatedAt: new Date().toISOString(),
                })
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.id, setId),
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                    ),
                );
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /** Deletes a logged set and renumbers the remaining entries. */
    async deleteSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        setId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        setId: string;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });
        return withTransaction(this.db, async (tx) => {
            await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId });
            const deleted = await tx
                .delete(setEntries)
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.id, setId),
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                    ),
                )
                .returning({ id: setEntries.id });
            if (deleted.length === 0) throw new EntityNotFoundError('Set not found');
            const remaining = await tx
                .select({ id: setEntries.id, setIndex: setEntries.setIndex })
                .from(setEntries)
                .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.sessionExerciseId, sessionExerciseId)))
                .orderBy(asc(setEntries.setIndex));
            for (const [offset, set] of remaining.entries())
                if (set.setIndex !== offset + 1)
                    await tx
                        .update(setEntries)
                        .set({ setIndex: offset + 1 })
                        .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.id, set.id)));
            await this.touch({ db: tx, workspaceId, sessionId });
            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    private async requireSession({
        db,
        workspaceId,
        sessionId,
        active,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
        active: boolean;
    }): Promise<void> {
        const [row] = await db
            .select({ completedAt: workoutSessions.completedAt })
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));
        if (row === undefined) throw new EntityNotFoundError('Session not found');
        if (active && row.completedAt !== null) throw new InvalidOperationError('Session is already completed');
    }

    private async requireSessionExercise({
        db,
        workspaceId,
        sessionId,
        sessionExerciseId,
        lock = false,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        lock?: boolean;
    }): Promise<SessionExerciseTargets & { trackingType: TrackingType }> {
        const query = db
            .select({
                trackingType: sessionExercises.trackingType,
                targetSets: sessionExercises.targetSets,
                restSeconds: sessionExercises.restSeconds,
                notes: sessionExercises.notes,
                targetReps: sessionExercises.targetReps,
                targetWeightKg: sessionExercises.targetWeightKg,
                targetDurationSeconds: sessionExercises.targetDurationSeconds,
                targetDistanceM: sessionExercises.targetDistanceM,
            })
            .from(sessionExercises)
            .where(
                scopedToWorkspace(
                    sessionExercises,
                    workspaceId,
                    eq(sessionExercises.id, sessionExerciseId),
                    eq(sessionExercises.sessionId, sessionId),
                ),
            );
        const [row] = await (lock ? query.for('update') : query);
        if (row === undefined) throw new EntityNotFoundError('Session exercise not found');
        return row;
    }

    private async requireAssignableExercise({
        db,
        workspaceId,
        exerciseId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        exerciseId: string;
    }): Promise<{ trackingType: TrackingType }> {
        const [row] = await db
            .select({ trackingType: exercises.trackingType })
            .from(exercises)
            .where(
                scopedToWorkspaceOrGlobal(
                    exercises,
                    workspaceId,
                    eq(exercises.id, exerciseId),
                    isNull(exercises.archivedAt),
                ),
            );
        if (row === undefined) throw new EntityNotFoundError('Exercise not found');
        return row;
    }

    private async loadRoutine({
        db,
        workspaceId,
        routineId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineId: string;
    }): Promise<{ id: string; name: string; slots: RoutineSlot[] }> {
        const [routine] = await db
            .select({ id: routines.id, name: routines.name })
            .from(routines)
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));
        if (routine === undefined) throw new EntityNotFoundError('Routine not found');
        const slots = await db
            .select({
                exerciseId: routineExercises.exerciseId,
                trackingType: exercises.trackingType,
                targetSets: routineExercises.targetSets,
                restSeconds: routineExercises.restSeconds,
                notes: routineExercises.notes,
                targetReps: routineExercises.targetReps,
                targetWeightKg: routineExercises.targetWeightKg,
                targetDurationSeconds: routineExercises.targetDurationSeconds,
                targetDistanceM: routineExercises.targetDistanceM,
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)))
            .orderBy(asc(routineExercises.position));
        return { ...routine, slots };
    }

    private async touch({
        db,
        workspaceId,
        sessionId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
    }): Promise<void> {
        await db
            .update(workoutSessions)
            .set({ updatedAt: new Date().toISOString() })
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));
    }

    private async loadDetail({
        db,
        workspaceId,
        sessionId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
    }): Promise<SessionDetail> {
        const [session] = await db
            .select(SUMMARY_COLUMNS)
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));
        if (session === undefined) throw new EntityNotFoundError('Session not found');
        const exerciseRows = await db
            .select({
                id: sessionExercises.id,
                position: sessionExercises.position,
                source: sessionExercises.source,
                trackingType: sessionExercises.trackingType,
                targetSets: sessionExercises.targetSets,
                restSeconds: sessionExercises.restSeconds,
                notes: sessionExercises.notes,
                skippedAt: sessionExercises.skippedAt,
                targetReps: sessionExercises.targetReps,
                targetWeightKg: sessionExercises.targetWeightKg,
                targetDurationSeconds: sessionExercises.targetDurationSeconds,
                targetDistanceM: sessionExercises.targetDistanceM,
                exercise: {
                    id: exercises.id,
                    name: exercises.name,
                    isCatalog: sql<boolean>`${exercises.workspaceId} is null`,
                    archivedAt: exercises.archivedAt,
                },
            })
            .from(sessionExercises)
            .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
            .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)))
            .orderBy(asc(sessionExercises.position));
        const setRows =
            exerciseRows.length === 0
                ? []
                : await db
                      .select({
                          id: setEntries.id,
                          sessionExerciseId: setEntries.sessionExerciseId,
                          setIndex: setEntries.setIndex,
                          completedAt: setEntries.completedAt,
                          isWarmup: setEntries.isWarmup,
                          rpe: setEntries.rpe,
                          weightKg: setEntries.weightKg,
                          reps: setEntries.reps,
                          durationSeconds: setEntries.durationSeconds,
                          distanceM: setEntries.distanceM,
                      })
                      .from(setEntries)
                      .where(
                          scopedToWorkspace(
                              setEntries,
                              workspaceId,
                              inArray(
                                  setEntries.sessionExerciseId,
                                  exerciseRows.map((row) => row.id),
                              ),
                          ),
                      )
                      .orderBy(asc(setEntries.setIndex));
        const setsByExercise = new Map<string, SessionSet[]>();
        for (const { sessionExerciseId, ...set } of setRows)
            setsByExercise.set(sessionExerciseId, [...(setsByExercise.get(sessionExerciseId) ?? []), set]);
        const rows: SessionExercise[] = exerciseRows.map((row) => ({ ...row, sets: setsByExercise.get(row.id) ?? [] }));
        return {
            ...session,
            exercises: rows,
            state: computeSessionState({ completedAt: session.completedAt, exercises: rows }),
        };
    }
}

type RoutineSlot = SessionExerciseTargets & { exerciseId: string; trackingType: TrackingType };

const SUMMARY_COLUMNS = {
    id: workoutSessions.id,
    name: workoutSessions.name,
    routineId: workoutSessions.routineId,
    startedAt: workoutSessions.startedAt,
    completedAt: workoutSessions.completedAt,
    notes: workoutSessions.notes,
    exerciseCount:
        sql<number>`(select count(*) from ${sessionExercises} where ${eq(sessionExercises.sessionId, workoutSessions.id)})`.mapWith(
            Number,
        ),
    setCount:
        sql<number>`(select count(*) from ${setEntries} inner join ${sessionExercises} on ${eq(sessionExercises.id, setEntries.sessionExerciseId)} where ${eq(sessionExercises.sessionId, workoutSessions.id)})`.mapWith(
            Number,
        ),
    createdAt: workoutSessions.createdAt,
    updatedAt: workoutSessions.updatedAt,
};

function targetsToRow(input: SessionExerciseInput): SessionExerciseTargets {
    return {
        targetSets: input.targetSets,
        restSeconds: input.restSeconds ?? null,
        notes: input.notes ?? null,
        targetReps: input.targetReps ?? null,
        targetWeightKg: input.targetWeightKg ?? null,
        targetDurationSeconds: input.targetDurationSeconds ?? null,
        targetDistanceM: input.targetDistanceM ?? null,
    };
}
function assertTargetsFit({
    trackingType,
    targets,
}: {
    trackingType: TrackingType;
    targets: Partial<SessionExerciseTargets>;
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
function assertSetFits({
    trackingType,
    measurements,
}: {
    trackingType: TrackingType;
    measurements: SetMeasurements;
}): void {
    const result = validateSetMeasurements({ trackingType, measurements });
    if (result.valid) return;
    const details = [
        result.missing.length === 0 ? null : `${trackingType} requires: ${result.missing.join(', ')}`,
        result.unexpected.length === 0 ? null : `${trackingType} does not use: ${result.unexpected.join(', ')}`,
    ].filter((detail): detail is string => detail !== null);
    throw new SetShapeMismatchError('Set does not match the exercise tracking type', details.join('; '));
}
function isActiveSessionViolation(error: unknown): boolean {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return cause?.code === '23505' && cause.constraint === ACTIVE_SESSION_INDEX;
}
