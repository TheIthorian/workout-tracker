import { withTransaction, type Db } from '@app/db';
import { MUSCLE_RECOVERY_DAYS, ROUTINE_FREQUENCY_WINDOW_DAYS, scoreRoutineRecommendations } from '@app/domain';
import { RoutineRecommendationStore } from './routine-recommendation.store.js';

/**
 * How old a stored score may get before a read recomputes it. Rest recovers with the clock even
 * when nothing is written, so a score from last week no longer reflects today.
 */
export const RECOMMENDATION_SCORE_MAX_AGE_HOURS = 24;

/**
 * Keeps each routine's stored recommendation score current. Other services call `recalculate`
 * after a write that changes a scoring input and rely on nothing else, so the work can move behind
 * a queue without touching them.
 */
export class RoutineRecommendationsService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Brings the workspace's routine recommendations up to date. Call it once a write that changes
     * an input has committed: a completed workout, a routine's exercises, exclusion or archiving, or
     * an exercise's muscles.
     */
    async recalculate({ workspaceId }: { workspaceId: string }): Promise<void> {
        const now = new Date();

        await withTransaction(this.db, async (tx) => {
            const store = new RoutineRecommendationStore({ db: tx });
            const candidates = await store.candidates({
                workspaceId,
                completionsSince: daysBefore({ date: now, days: ROUTINE_FREQUENCY_WINDOW_DAYS }),
            });
            const history = await store.history({
                workspaceId,
                since: daysBefore({ date: now, days: MUSCLE_RECOVERY_DAYS }),
            });

            await store.save({
                workspaceId,
                recommendations: scoreRoutineRecommendations({ candidates, history, now }),
                scoredAt: now,
            });
        });
    }

    /**
     * Recalculates only if an active routine has never been scored or its score is older than
     * `RECOMMENDATION_SCORE_MAX_AGE_HOURS`, so a read pays for scoring at most daily.
     */
    async recalculateIfStale({ workspaceId }: { workspaceId: string }): Promise<void> {
        const scoredBefore = new Date(Date.now() - RECOMMENDATION_SCORE_MAX_AGE_HOURS * MS_PER_HOUR);
        const stale = await new RoutineRecommendationStore({ db: this.db }).hasStale({ workspaceId, scoredBefore });

        if (stale) await this.recalculate({ workspaceId });
    }
}

function daysBefore({ date, days }: { date: Date; days: number }): Date {
    return new Date(date.getTime() - days * 24 * MS_PER_HOUR);
}

const MS_PER_HOUR = 60 * 60 * 1000;
