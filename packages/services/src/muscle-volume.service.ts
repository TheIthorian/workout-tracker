import { schema, scopedToWorkspace, type Db } from '@app/db';
import { summariseMuscleVolume, type MuscleGroup, type MuscleVolumeTotal } from '@app/domain';
import { count, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, sessionExercises, setEntries, workoutSessions } = schema;

/** One exercise's share of a window's work, for the "what drove this" list under the heatmap. */
export type MuscleVolumeExercise = {
    exerciseId: string;
    name: string;
    sets: number;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
};

export type MuscleVolumeSummary = {
    days: number;
    since: string;
    sessionCount: number;
    totalSets: number;
    untaggedSets: number;
    muscles: MuscleVolumeTotal[];
    exercises: MuscleVolumeExercise[];
};

/**
 * Turns completed workout history into per-muscle training volume — what the body heatmap shades.
 *
 * Warm-up sets are left out: they are part of getting ready to train a muscle rather than training
 * it, and counting them would make a long warm-up read as hard work.
 */
export class MuscleVolumeService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * Summarises the last `days` days of completed workouts, by muscle and by exercise.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async summarise({
        userId,
        workspaceId,
        days,
    }: {
        userId: string;
        workspaceId: string;
        days: number;
    }): Promise<MuscleVolumeSummary> {
        await this.membership.require({ userId, workspaceId });

        const since = new Date(Date.now() - days * MILLISECONDS_PER_DAY).toISOString();

        const completedInWindow = scopedToWorkspace(
            sessionExercises,
            workspaceId,
            isNotNull(workoutSessions.completedAt),
            gte(workoutSessions.completedAt, since),
        );

        const [perExercise, [sessions]] = await Promise.all([
            this.db
                .select({
                    exerciseId: exercises.id,
                    name: exercises.name,
                    primaryMuscles: exercises.primaryMuscles,
                    secondaryMuscles: exercises.secondaryMuscles,
                    sets: count(setEntries.id),
                })
                .from(sessionExercises)
                .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
                .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
                .leftJoin(setEntries, workingSetsOf(workspaceId))
                .where(completedInWindow)
                .groupBy(exercises.id, exercises.name, exercises.primaryMuscles, exercises.secondaryMuscles)
                .orderBy(desc(count(setEntries.id)), exercises.name),
            this.db
                .select({ sessionCount: sql<number>`count(distinct ${workoutSessions.id})::int` })
                .from(sessionExercises)
                .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
                .where(completedInWindow),
        ]);

        const muscles = summariseMuscleVolume({ contributions: perExercise });

        return {
            days,
            since,
            sessionCount: sessions?.sessionCount ?? 0,
            totalSets: perExercise.reduce((total, row) => total + row.sets, 0),
            untaggedSets: perExercise
                .filter((row) => row.primaryMuscles.length === 0 && row.secondaryMuscles.length === 0)
                .reduce((total, row) => total + row.sets, 0),
            muscles,
            exercises: perExercise.filter((row) => row.sets > 0),
        };
    }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Attaches the working sets logged against each appearance. A left join keeps an exercise that was
 * started and logged nothing, which the caller drops on its own terms rather than by accident.
 */
function workingSetsOf(workspaceId: string): SQL {
    return scopedToWorkspace(
        setEntries,
        workspaceId,
        eq(setEntries.sessionExerciseId, sessionExercises.id),
        eq(setEntries.isWarmup, false),
    );
}
