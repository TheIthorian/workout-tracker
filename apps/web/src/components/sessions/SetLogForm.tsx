import { useEffect, useState, type ComponentProps } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrackingType } from '@/models/exercise';
import type { LogSetRequest, SessionExercise, SessionSet } from '@/models/session';

type SetLogFormProps = {
    exercise: SessionExercise;
    previousSet: SessionSet | null;
    isPending: boolean;
    onLog: (data: LogSetRequest) => void;
};

/** The one-tap logging form, with only the fields valid for the exercise's tracking type. */
export function SetLogForm({ exercise, previousSet, isPending, onLog }: SetLogFormProps): JSX.Element {
    const [weightKg, setWeightKg] = useState(numberDraft(previousSet?.weightKg ?? exercise.targetWeightKg));
    const [reps, setReps] = useState(numberDraft(previousSet?.reps ?? exercise.targetReps));
    const [durationSeconds, setDurationSeconds] = useState(
        numberDraft(previousSet?.durationSeconds ?? exercise.targetDurationSeconds),
    );
    const [distanceM, setDistanceM] = useState(numberDraft(previousSet?.distanceM ?? exercise.targetDistanceM));
    const [isWarmup, setWarmup] = useState(false);
    const [rpe, setRpe] = useState('');

    useEffect(() => {
        setWeightKg(numberDraft(previousSet?.weightKg ?? exercise.targetWeightKg));
        setReps(numberDraft(previousSet?.reps ?? exercise.targetReps));
        setDurationSeconds(numberDraft(previousSet?.durationSeconds ?? exercise.targetDurationSeconds));
        setDistanceM(numberDraft(previousSet?.distanceM ?? exercise.targetDistanceM));
        setWarmup(false);
        setRpe('');
    }, [
        exercise.id,
        exercise.targetDistanceM,
        exercise.targetDurationSeconds,
        exercise.targetReps,
        exercise.targetWeightKg,
        previousSet?.distanceM,
        previousSet?.durationSeconds,
        previousSet?.reps,
        previousSet?.weightKg,
    ]);

    const log = (): void => {
        const data: LogSetRequest = { isWarmup, rpe: optionalNumber(rpe) };
        if (exercise.trackingType === TrackingType.WeightReps) {
            data.reps = requiredNumber(reps);
            data.weightKg = optionalNumber(weightKg);
        }
        if (exercise.trackingType === TrackingType.Duration) data.durationSeconds = requiredNumber(durationSeconds);
        if (exercise.trackingType === TrackingType.DistanceTime) {
            data.distanceM = requiredNumber(distanceM);
            data.durationSeconds = requiredNumber(durationSeconds);
        }
        onLog(data);
    };

    const valid =
        exercise.trackingType === TrackingType.WeightReps
            ? requiredNumber(reps) !== null
            : exercise.trackingType === TrackingType.Duration
              ? requiredNumber(durationSeconds) !== null
              : requiredNumber(distanceM) !== null && requiredNumber(durationSeconds) !== null;

    return (
        <div className="space-y-3 rounded-xl bg-secondary/50 p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {exercise.trackingType === TrackingType.WeightReps && (
                    <NumberField label="Weight (kg)" value={weightKg} onChange={setWeightKg} step="0.25" min="0" />
                )}
                {exercise.trackingType === TrackingType.WeightReps && (
                    <NumberField label="Reps" value={reps} onChange={setReps} min="0" required />
                )}
                {exercise.trackingType === TrackingType.Duration && (
                    <NumberField
                        label="Seconds"
                        value={durationSeconds}
                        onChange={setDurationSeconds}
                        min="0"
                        required
                    />
                )}
                {exercise.trackingType === TrackingType.DistanceTime && (
                    <NumberField
                        label="Distance (m)"
                        value={distanceM}
                        onChange={setDistanceM}
                        step="0.1"
                        min="0"
                        required
                    />
                )}
                {exercise.trackingType === TrackingType.DistanceTime && (
                    <NumberField
                        label="Seconds"
                        value={durationSeconds}
                        onChange={setDurationSeconds}
                        min="0"
                        required
                    />
                )}
                <NumberField label="RPE" value={rpe} onChange={setRpe} step="0.5" min="0" max="10" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={isWarmup} onCheckedChange={(checked) => setWarmup(checked === true)} />
                    Warm-up set
                </label>
                <Button onClick={log} disabled={!valid || isPending} className="min-w-32 gap-2">
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

/** A consistently labelled numeric set field. */
function NumberField({
    label,
    value,
    onChange,
    required = false,
    ...inputProps
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange'>): JSX.Element {
    return (
        <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
                {label}
                {required && <span className="text-destructive"> *</span>}
            </Label>
            <Input
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="h-10 bg-background"
                {...inputProps}
            />
        </div>
    );
}

/** Converts a filled-in number input to an API value. */
function optionalNumber(value: string): number | null {
    const parsed = Number(value);
    return value.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
}

/** Converts a required number input to an API value. */
function requiredNumber(value: string): number | null {
    return optionalNumber(value);
}

/** Makes a nullable stored measurement suitable for a controlled numeric input. */
function numberDraft(value: number | null | undefined): string {
    return value?.toString() ?? '';
}
