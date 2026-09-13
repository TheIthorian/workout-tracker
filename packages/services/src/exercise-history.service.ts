import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, type Db } from '@app/db';
import type { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';
import type { SessionSet } from './workout-sessions.service.js';

const { exercises, sessionExercises, setEntries, workoutSessions } = schema;

export type ExerciseHistoryEntry = {
    sessionId: string;
    sessionName: string;
    startedAt: string;
    completedAt: string;
    sessionExerciseId: string;
    trackingType: TrackingType;
    sets: SessionSet[];
};
export type ExerciseHistory = { data: ExerciseHistoryEntry[] };

/** Reads completed-session appearances for a visible exercise. */
export class ExerciseHistoryService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /** Returns recent completed appearances of an exercise, newest first. */
    async recent({
        userId,
        workspaceId,
        exerciseId,
        limit,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        limit: number;
    }): Promise<ExerciseHistory> {
        await this.membership.require({ userId, workspaceId });
        const [exercise] = await this.db
            .select({ id: exercises.id })
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.id, exerciseId)));
        if (exercise === undefined) throw new EntityNotFoundError('Exercise not found');
        const appearances = await this.db
            .select({
                sessionId: workoutSessions.id,
                sessionName: workoutSessions.name,
                startedAt: workoutSessions.startedAt,
                completedAt: workoutSessions.completedAt,
                sessionExerciseId: sessionExercises.id,
                trackingType: sessionExercises.trackingType,
            })
            .from(sessionExercises)
            .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
            .where(
                scopedToWorkspace(
                    sessionExercises,
                    workspaceId,
                    eq(sessionExercises.exerciseId, exerciseId),
                    isNotNull(workoutSessions.completedAt),
                ),
            )
            .orderBy(desc(workoutSessions.startedAt), asc(sessionExercises.position))
            .limit(limit);
        if (appearances.length === 0) return { data: [] };
        const rows = await this.db
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
                        appearances.map((row) => row.sessionExerciseId),
                    ),
                ),
            )
            .orderBy(asc(setEntries.setIndex));
        const grouped = new Map<string, SessionSet[]>();
        for (const { sessionExerciseId, ...set } of rows)
            grouped.set(sessionExerciseId, [...(grouped.get(sessionExerciseId) ?? []), set]);
        return {
            data: appearances.map((row) => ({
                ...row,
                completedAt: row.completedAt as string,
                sets: grouped.get(row.sessionExerciseId) ?? [],
            })),
        };
    }
}
