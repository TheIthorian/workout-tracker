import { useEffect, useState } from 'react';
import { Check, Plus, Sparkles } from 'lucide-react';
import { StepperField } from '@/components/common/StepperField';
import { RpeHint } from '@/components/sessions/RpeHint';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NextEffortSource, TrackingType, type ExerciseSuggestion } from '@/models/exercise';
import { formatSessionClock, type LogSetRequest, type SessionExercise, type SessionSet } from '@/models/session';

type SetLogFormProps = {
    exercise: SessionExercise;
    previousSet: SessionSet | null;
    /** What to fill in when the user asks for a suggestion; null while it is still loading. */
    suggestion: ExerciseSuggestion | null;
    isPending: boolean;
    onLog: (data: LogSetRequest) => void;
    onApplySuggestion: (suggestion: ExerciseSuggestion) => void;
};

const WEIGHT_STEP_KG = 2.5;
const DURATION_STEP_SECONDS = 5;
const CARDIO_TIME_STEP_SECONDS = 30;
const DISTANCE_STEP_M = 100;
const RPE_STEP = 0.5;
// Most sets land between 6 and 8, so an empty field jumps straight to the nearer end.
const RPE_EMPTY_DEFAULTS = { increase: 8, decrease: 6 };

/** The one-tap logging form, with only the fields valid for the exercise's tracking type. */
export function SetLogForm({
    exercise,
    previousSet,
    suggestion,
    isPending,
    onLog,
    onApplySuggestion,
}: SetLogFormProps): JSX.Element {
    const [weightKg, setWeightKg] = useState(previousSet?.weightKg ?? exercise.targetWeightKg);
    const [reps, setReps] = useState(previousSet?.reps ?? exercise.targetReps);
    const [durationSeconds, setDurationSeconds] = useState(
        previousSet?.durationSeconds ?? exercise.targetDurationSeconds,
    );
    const [distanceM, setDistanceM] = useState(previousSet?.distanceM ?? exercise.targetDistanceM);
    const [isWarmup, setWarmup] = useState(false);
    const [rpe, setRpe] = useState(previousSet?.rpe ?? null);

    useEffect(() => {
        setWeightKg(previousSet?.weightKg ?? exercise.targetWeightKg);
        setReps(previousSet?.reps ?? exercise.targetReps);
        setDurationSeconds(previousSet?.durationSeconds ?? exercise.targetDurationSeconds);
        setDistanceM(previousSet?.distanceM ?? exercise.targetDistanceM);
        setWarmup(false);
        setRpe(previousSet?.rpe ?? null);
    }, [
        exercise.id,
        exercise.targetDistanceM,
        exercise.targetDurationSeconds,
        exercise.targetReps,
        exercise.targetWeightKg,
        previousSet?.distanceM,
        previousSet?.durationSeconds,
        previousSet?.reps,
        previousSet?.rpe,
        previousSet?.weightKg,
    ]);

    const applySuggestion = (): void => {
        if (suggestion === null) return;

        if (exercise.trackingType === TrackingType.WeightReps) {
            setWeightKg(suggestion.weightKg);
            setReps(suggestion.reps);
        }
        if (exercise.trackingType === TrackingType.Duration) setDurationSeconds(suggestion.durationSeconds);
        if (exercise.trackingType === TrackingType.DistanceTime) {
            setDistanceM(suggestion.distanceM);
            setDurationSeconds(suggestion.durationSeconds);
        }

        onApplySuggestion(suggestion);
    };

    const log = (): void => {
        const data: LogSetRequest = { isWarmup, rpe };
        if (exercise.trackingType === TrackingType.WeightReps) {
            data.reps = reps;
            data.weightKg = weightKg;
        }
        if (exercise.trackingType === TrackingType.Duration) data.durationSeconds = durationSeconds;
        if (exercise.trackingType === TrackingType.DistanceTime) {
            data.distanceM = distanceM;
            data.durationSeconds = durationSeconds;
        }
        onLog(data);
    };

    // A baseline answer carries advice but no numbers, and the card already shows that advice.
    const canSuggest = suggestion === null || suggestion.source !== NextEffortSource.Baseline;

    const valid =
        exercise.trackingType === TrackingType.WeightReps
            ? reps !== null
            : exercise.trackingType === TrackingType.Duration
              ? durationSeconds !== null
              : distanceM !== null && durationSeconds !== null;

    return (
        <div className="space-y-4 rounded-xl bg-secondary/50 p-3">
            <div className="grid gap-4 sm:grid-cols-2">
                {exercise.trackingType === TrackingType.WeightReps && (
                    <StepperField label="Weight (kg)" value={weightKg} onChange={setWeightKg} step={WEIGHT_STEP_KG} />
                )}
                {exercise.trackingType === TrackingType.WeightReps && (
                    <StepperField label="Reps" value={reps} onChange={setReps} step={1} required />
                )}
                {exercise.trackingType === TrackingType.DistanceTime && (
                    <StepperField
                        label="Distance (m)"
                        value={distanceM}
                        onChange={setDistanceM}
                        step={DISTANCE_STEP_M}
                        required
                    />
                )}
                {exercise.trackingType !== TrackingType.WeightReps && (
                    <StepperField
                        label="Time"
                        value={durationSeconds}
                        onChange={setDurationSeconds}
                        step={
                            exercise.trackingType === TrackingType.Duration
                                ? DURATION_STEP_SECONDS
                                : CARDIO_TIME_STEP_SECONDS
                        }
                        format={formatSessionClock}
                        required
                    />
                )}
                <StepperField
                    label="RPE"
                    value={rpe}
                    onChange={setRpe}
                    step={RPE_STEP}
                    emptyDefaults={RPE_EMPTY_DEFAULTS}
                    max={10}
                    hint={<RpeHint />}
                />
            </div>
            {canSuggest && (
                <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full gap-2 sm:w-auto"
                    onClick={applySuggestion}
                    disabled={suggestion === null}
                >
                    <Sparkles className="h-4 w-4" aria-hidden />
                    Suggest my next set
                </Button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={isWarmup} onCheckedChange={(checked) => setWarmup(checked === true)} />
                    Warm-up set
                </label>
                <Button
                    onClick={log}
                    disabled={!valid || isPending}
                    size="lg"
                    className="min-w-40 flex-1 gap-2 sm:flex-none"
                >
                    {isPending ? (
                        <Plus className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                        <Check className="h-4 w-4" aria-hidden />
                    )}
                    {isPending ? 'Logging…' : isWarmup ? 'Log warm-up' : 'Log set'}
                </Button>
            </div>
        </div>
    );
}
