import { schema, scopedToWorkspace, withTransaction, type Db, type Tx } from '@app/db';
import { MUSCLE_RECOVERY_DAYS, ROUTINE_FREQUENCY_WINDOW_DAYS, scoreRoutineRecommendations } from '@app/domain';
import { count, eq, gte, isNotNull, isNull, lt, or } from 'drizzle-orm';

const { exercises, routineExercises, routines, sessionExercises, setEntries, workoutSessions } = schema;

/**
 * How old a stored score may get before a read recomputes it. Rest recovers with the clock even
 * when nothing is written, so a score from last week no longer reflects today.
 */
export const RECOMMENDATION_SCORE_MAX_AGE_HOURS = 24;

/**
 * Brings the workspace's routine recommendations up to date. Call it once a write that changes an
 * input has committed: a completed workout, a routine's exercises, exclusion or archiving, or an
 * exercise's muscles. Callers rely only on this signature, so the work can move behind a queue.
 */
export async function recalculateRoutineRecommendations({
    db,
    workspaceId,
}: {
    db: Db;
    workspaceId: string;
}): Promise<void> {
    await withTransaction(db, (tx) => scoreAndStore({ tx, workspaceId, now: new Date() }));
}

/**
 * Recalculates only if an active routine has never been scored or its score is older than
 * `RECOMMENDATION_SCORE_MAX_AGE_HOURS`, so a read pays for scoring at most daily.
 */
export async function recalculateStaleRoutineRecommendations({
    db,
    workspaceId,
}: {
    db: Db;
    workspaceId: string;
}): Promise<void> {
    const staleBefore = new Date(Date.now() - RECOMMENDATION_SCORE_MAX_AGE_HOURS * MS_PER_HOUR).toISOString();

    const [stale] = await db
        .select({ id: routines.id })
        .from(routines)
        .where(
            scopedToWorkspace(
                routines,
                workspaceId,
                isNull(routines.archivedAt),
                or(isNull(routines.recommendationScoredAt), lt(routines.recommendationScoredAt, staleBefore)),
            ),
        )
        .limit(1);

    if (stale) await recalculateRoutineRecommendations({ db, workspaceId });
}

/** Scores every active routine from history and stores it; archived routines are cleared. */
async function scoreAndStore({ tx, workspaceId, now }: { tx: Tx; workspaceId: string; now: Date }): Promise<void> {
    const recoverySince = new Date(now.getTime() - MUSCLE_RECOVERY_DAYS * MS_PER_DAY).toISOString();
    const frequencySince = new Date(now.getTime() - ROUTINE_FREQUENCY_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const scoredAt = now.toISOString();

    const active = await tx
        .select({ id: routines.id, excludedFromRecommendations: routines.excludedFromRecommendations })
        .from(routines)
        .where(scopedToWorkspace(routines, workspaceId, isNull(routines.archivedAt)));
    // The tenant filter sits on `routine_exercises`; the joined exercise may be catalog content.
    const slots = await tx
        .select({
            routineId: routineExercises.routineId,
            primaryMuscles: exercises.primaryMuscles,
            secondaryMuscles: exercises.secondaryMuscles,
        })
        .from(routineExercises)
        .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
        .where(scopedToWorkspace(routineExercises, workspaceId));
    const completions = await tx
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
        .groupBy(workoutSessions.routineId);
    // Only exercises with a working set logged count as training the muscle; a warm-up, or an
    // exercise added and skipped, leaves it rested.
    const history = await tx
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
        .where(scopedToWorkspace(sessionExercises, workspaceId, gte(workoutSessions.completedAt, recoverySince)));

    const slotsByRoutine = new Map<string, typeof slots>();
    for (const slot of slots) {
        slotsByRoutine.set(slot.routineId, [...(slotsByRoutine.get(slot.routineId) ?? []), slot]);
    }

    const completionsByRoutine = new Map(completions.map((row) => [row.routineId, row.completions]));

    const scores = scoreRoutineRecommendations({
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

    await tx
        .update(routines)
        .set({ recommendationScore: null, recommendationScoredAt: scoredAt })
        .where(scopedToWorkspace(routines, workspaceId, isNotNull(routines.archivedAt)));

    for (const [routineId, score] of scores) {
        await tx
            .update(routines)
            .set({ recommendationScore: score, recommendationScoredAt: scoredAt })
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));
    }
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
