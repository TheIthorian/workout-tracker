import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, type Db } from '@app/db';
import { suggestNextEffort, type LastPerformance, type NextEffortSuggestion, type TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { desc, eq, isNotNull } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, exerciseTargets, sessionExercises, setEntries, workoutSessions } = schema;

export type ExerciseTarget = {
    exerciseId: string;
    trackingType: TrackingType;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ExerciseSuggestion = NextEffortSuggestion & {
    exerciseId: string;
    trackingType: TrackingType;
    lastPerformedAt: string | null;
    target: ExerciseTarget | null;
};

/**
 * The target a workspace has set for its next go at an exercise, and the suggestion built from it
 * and the exercise's history.
 *
 * A target may be set against a catalog exercise as well as a custom one: the target belongs to the
 * workspace, not to the shared exercise, so it is stored and read with `scopedToWorkspace` while
 * the exercise itself is resolved with `scopedToWorkspaceOrGlobal`.
 */
export class ExerciseTargetsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * Replaces the target for an exercise with the measurements given.
     *
     * @throws EntityNotFoundError when the exercise is not visible to the workspace.
     */
    async set({
        userId,
        workspaceId,
        exerciseId,
        weightKg,
        reps,
        durationSeconds,
        distanceM,
        note,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        weightKg?: number | null;
        reps?: number | null;
        durationSeconds?: number | null;
        distanceM?: number | null;
        note?: string | null;
    }): Promise<ExerciseTarget> {
        await this.membership.require({ userId, workspaceId });
        const trackingType = await this.requireExercise({ workspaceId, exerciseId });
        const now = new Date().toISOString();
        const values = {
            weightKg: weightKg ?? null,
            reps: reps ?? null,
            durationSeconds: durationSeconds ?? null,
            distanceM: distanceM ?? null,
            note: note ?? null,
        };

        const [row] = await this.db
            .insert(exerciseTargets)
            .values({ workspaceId, exerciseId, ...values, updatedAt: now })
            .onConflictDoUpdate({
                target: [exerciseTargets.workspaceId, exerciseTargets.exerciseId],
                set: { ...values, updatedAt: now },
            })
            .returning();

        if (row === undefined) throw new EntityNotFoundError('Exercise target not found');

        return toTarget({ row, trackingType });
    }

    /**
     * Removes the target for an exercise. Succeeds whether or not one was set, so a caller clearing
     * an already-clear target is not an error.
     *
     * @throws EntityNotFoundError when the exercise is not visible to the workspace.
     */
    async clear({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });
        await this.requireExercise({ workspaceId, exerciseId });

        await this.db
            .delete(exerciseTargets)
            .where(scopedToWorkspace(exerciseTargets, workspaceId, eq(exerciseTargets.exerciseId, exerciseId)));
    }

    /**
     * Suggests what to open the next session with — the stored target while it is unused, otherwise
     * a progression from the last working set, otherwise advice to establish a baseline.
     *
     * @throws EntityNotFoundError when the exercise is not visible to the workspace.
     */
    async suggest({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<ExerciseSuggestion> {
        await this.membership.require({ userId, workspaceId });
        const trackingType = await this.requireExercise({ workspaceId, exerciseId });
        const [target, lastPerformance] = await Promise.all([
            this.loadTarget({ workspaceId, exerciseId, trackingType }),
            this.loadLastPerformance({ workspaceId, exerciseId }),
        ]);

        const suggestion = suggestNextEffort({
            trackingType,
            target: target === null ? null : { ...target, setAt: target.updatedAt },
            lastPerformance,
        });

        return {
            ...suggestion,
            exerciseId,
            trackingType,
            lastPerformedAt: lastPerformance?.performedAt ?? null,
            target,
        };
    }

    /** Resolves a visible exercise to its tracking type, which decides a target's usable fields. */
    private async requireExercise({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<TrackingType> {
        const [exercise] = await this.db
            .select({ trackingType: exercises.trackingType })
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (exercise === undefined) throw new EntityNotFoundError('Exercise not found');

        return exercise.trackingType;
    }

    private async loadTarget({
        workspaceId,
        exerciseId,
        trackingType,
    }: {
        workspaceId: string;
        exerciseId: string;
        trackingType: TrackingType;
    }): Promise<ExerciseTarget | null> {
        const [row] = await this.db
            .select()
            .from(exerciseTargets)
            .where(scopedToWorkspace(exerciseTargets, workspaceId, eq(exerciseTargets.exerciseId, exerciseId)));

        return row === undefined ? null : toTarget({ row, trackingType });
    }

    /**
     * Reads the latest non-warm-up set from a completed session. Warm-ups are excluded because they
     * say nothing about what the exercise can be loaded with next time.
     */
    private async loadLastPerformance({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<LastPerformance | null> {
        const [row] = await this.db
            .select({
                weightKg: setEntries.weightKg,
                reps: setEntries.reps,
                durationSeconds: setEntries.durationSeconds,
                distanceM: setEntries.distanceM,
                rpe: setEntries.rpe,
                performedAt: workoutSessions.completedAt,
            })
            .from(setEntries)
            .innerJoin(sessionExercises, eq(sessionExercises.id, setEntries.sessionExerciseId))
            .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
            .where(
                scopedToWorkspace(
                    setEntries,
                    workspaceId,
                    eq(sessionExercises.exerciseId, exerciseId),
                    isNotNull(workoutSessions.completedAt),
                    eq(setEntries.isWarmup, false),
                ),
            )
            .orderBy(desc(workoutSessions.completedAt), desc(setEntries.setIndex))
            .limit(1);

        // `completedAt` is non-null by the filter above; a session only counts once it is finished.
        return row === undefined ? null : { ...row, performedAt: row.performedAt as string };
    }
}

type ExerciseTargetRow = typeof exerciseTargets.$inferSelect;

/** Adds the exercise's tracking type, which the stored row does not carry, to the wire shape. */
function toTarget({ row, trackingType }: { row: ExerciseTargetRow; trackingType: TrackingType }): ExerciseTarget {
    return {
        exerciseId: row.exerciseId,
        trackingType,
        weightKg: row.weightKg,
        reps: row.reps,
        durationSeconds: row.durationSeconds,
        distanceM: row.distanceM,
        note: row.note,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
