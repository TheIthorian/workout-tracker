import { schema, scopedToWorkspace, type Db, type Tx } from '@app/db';
import type { RecommendationCandidate, RoutineRecommendation, TrainedExercise } from '@app/domain';
import { count, eq, gte, isNotNull, isNull, lt, max, or } from 'drizzle-orm';

const { exercises, routineExercises, routines, sessionExercises, setEntries, workoutSessions } = schema;

/**
 * The queries behind routine recommendations: what the scoring reads, and where its results are
 * stored. Holds no scoring logic of its own; that lives in `@app/domain`.
 */
export class RoutineRecommendationStore {
    private readonly db: Db | Tx;

    constructor({ db }: { db: Db | Tx }) {
        this.db = db;
    }

    /**
     * Every active routine in the workspace, with the muscles its exercises tag and how many
     * workouts from it were completed since `completionsSince`.
     */
    async candidates({
        workspaceId,
        completionsSince,
    }: {
        workspaceId: string;
        completionsSince: Date;
    }): Promise<RecommendationCandidate[]> {
        const active = await this.db
            .select({ id: routines.id, excludedFromRecommendations: routines.excludedFromRecommendations })
            .from(routines)
            .where(scopedToWorkspace(routines, workspaceId, isNull(routines.archivedAt)));
        // One row per distinct exercise in each routine, however often it repeats. The tenant filter
        // sits on `routine_exercises`; the joined exercise may be catalog content.
        const exercisesByRoutine = await this.db
            .select({
                routineId: routineExercises.routineId,
                primaryMuscles: exercises.primaryMuscles,
                secondaryMuscles: exercises.secondaryMuscles,
                slots: count(),
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId))
            .groupBy(routineExercises.routineId, exercises.id);
        const completions = await this.db
            .select({ routineId: workoutSessions.routineId, completions: count() })
            .from(workoutSessions)
            .where(
                scopedToWorkspace(
                    workoutSessions,
                    workspaceId,
                    isNotNull(workoutSessions.routineId),
                    gte(workoutSessions.completedAt, completionsSince.toISOString()),
                ),
            )
            .groupBy(workoutSessions.routineId);

        const completionsByRoutine = new Map(completions.map((row) => [row.routineId, row.completions]));
        const candidates = new Map<string, RecommendationCandidate>(
            active.map((routine) => [
                routine.id,
                {
                    id: routine.id,
                    excludedFromRecommendations: routine.excludedFromRecommendations,
                    exerciseCount: 0,
                    primaryMuscles: [],
                    secondaryMuscles: [],
                    recentCompletions: completionsByRoutine.get(routine.id) ?? 0,
                },
            ]),
        );

        for (const row of exercisesByRoutine) {
            const candidate = candidates.get(row.routineId);
            if (!candidate) continue;

            candidate.exerciseCount += row.slots;
            candidate.primaryMuscles.push(...row.primaryMuscles);
            candidate.secondaryMuscles.push(...row.secondaryMuscles);
        }

        return [...candidates.values()];
    }

    /**
     * Each exercise trained in a workout completed since `since`, once, at its latest completion:
     * the scoring only needs when a muscle was last worked. Only an exercise with a working set
     * logged counts: a warm-up, or an exercise added and skipped, leaves its muscles rested.
     */
    async history({ workspaceId, since }: { workspaceId: string; since: Date }): Promise<TrainedExercise[]> {
        const rows = await this.db
            .select({
                primaryMuscles: exercises.primaryMuscles,
                secondaryMuscles: exercises.secondaryMuscles,
                completedAt: max(workoutSessions.completedAt),
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
                scopedToWorkspace(sessionExercises, workspaceId, gte(workoutSessions.completedAt, since.toISOString())),
            )
            .groupBy(exercises.id);

        return rows.flatMap((row) =>
            row.completedAt === null ? [] : [{ ...row, completedAt: new Date(row.completedAt) }],
        );
    }

    /**
     * Stores each recommendation's score against its routine, stamped `scoredAt`. Archived routines
     * are cleared, since they are never candidates. `recommendations` is read once, so it may be a
     * generator.
     */
    async save({
        workspaceId,
        recommendations,
        scoredAt,
    }: {
        workspaceId: string;
        recommendations: Iterable<RoutineRecommendation>;
        scoredAt: Date;
    }): Promise<void> {
        const stamp = scoredAt.toISOString();

        await this.db
            .update(routines)
            .set({ recommendationScore: null, recommendationScoredAt: stamp })
            .where(scopedToWorkspace(routines, workspaceId, isNotNull(routines.archivedAt)));

        for (const { routineId, score } of recommendations) {
            await this.db
                .update(routines)
                .set({ recommendationScore: score, recommendationScoredAt: stamp })
                .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));
        }
    }

    /** Whether an active routine has never been scored, or was last scored before `scoredBefore`. */
    async hasStale({ workspaceId, scoredBefore }: { workspaceId: string; scoredBefore: Date }): Promise<boolean> {
        const [stale] = await this.db
            .select({ id: routines.id })
            .from(routines)
            .where(
                scopedToWorkspace(
                    routines,
                    workspaceId,
                    isNull(routines.archivedAt),
                    or(
                        isNull(routines.recommendationScoredAt),
                        lt(routines.recommendationScoredAt, scoredBefore.toISOString()),
                    ),
                ),
            )
            .limit(1);

        return stale !== undefined;
    }
}
