import { formatDate } from '@/lib/date-format';
import { TrackingType } from '@/models/exercise';
import { formatSessionClock, formatSessionNumber, type SessionDetail, type SessionExercise } from '@/models/session';

/** Renders a workout as plain text suitable for pasting into a chat with an agent. */
export function buildSessionSummary(session: SessionDetail): string {
    const lines: string[] = [`${session.name} — ${formatDate(session.startedAt)}`];
    const isComplete = session.completedAt !== null;

    lines.push(isComplete ? 'Status: completed' : 'Status: in progress');

    const elapsed = elapsedMinutes(session);
    if (elapsed !== null) lines.push(`Duration: ${elapsed} min`);

    lines.push(`Working sets: ${session.state.progress.loggedSets} of ${session.state.progress.targetSets}`, '');

    if (session.exercises.length === 0) {
        lines.push('No exercises logged.');
    } else {
        session.exercises.forEach((exercise, index) => {
            lines.push(...summarizeExercise({ exercise, position: index + 1 }));
            lines.push('');
        });
        lines.pop();
    }

    if (session.notes) lines.push('', `Notes: ${session.notes}`);

    return lines.join('\n');
}

/** Renders one exercise as its heading line followed by an indented line per set. */
function summarizeExercise({ exercise, position }: { exercise: SessionExercise; position: number }): string[] {
    const workingSets = exercise.sets.filter((set) => !set.isWarmup).length;
    const heading = `${position}. ${exercise.exercise.name} (${workingSets}/${exercise.targetSets} working sets)${
        exercise.skippedAt === null ? '' : ' - skipped'
    }`;
    const lines = [heading];

    for (const set of exercise.sets) {
        const label = set.isWarmup ? 'Warm-up' : `Set ${set.setIndex}`;
        const rpe = set.rpe === null ? '' : ` (RPE ${set.rpe})`;

        lines.push(`   ${label}: ${describeSet({ exercise, set })}${rpe}`);
    }

    if (exercise.sets.length === 0) lines.push('   No sets logged');
    if (exercise.notes) lines.push(`   Notes: ${exercise.notes}`);

    return lines;
}

/** Formats a recorded set using only the fields its tracking type allows. */
function describeSet({ exercise, set }: { exercise: SessionExercise; set: SessionExercise['sets'][number] }): string {
    switch (exercise.trackingType) {
        case TrackingType.WeightReps:
            return `${set.reps ?? 0} reps${set.weightKg === null ? '' : ` @ ${formatSessionNumber(set.weightKg)} kg`}`;
        case TrackingType.Duration:
            return formatSessionClock(set.durationSeconds ?? 0);
        case TrackingType.DistanceTime:
            return `${formatSessionNumber(set.distanceM ?? 0)} m in ${formatSessionClock(set.durationSeconds ?? 0)}`;
    }
}

/** Whole minutes between a workout's start and its completion, or null while it is still running. */
function elapsedMinutes(session: SessionDetail): number | null {
    if (session.completedAt === null) return null;

    const started = new Date(session.startedAt).getTime();
    const completed = new Date(session.completedAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;

    return Math.max(0, Math.round((completed - started) / 60_000));
}
