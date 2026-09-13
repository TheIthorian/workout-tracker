import { useEffect, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrackingType } from '@/models/exercise';
import type { PatchSetRequest, SessionExercise, SessionSet } from '@/models/session';

type SetEditDialogProps = {
    exercise: SessionExercise | null;
    set: SessionSet | null;
    isSaving: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: PatchSetRequest) => void;
};

/** Corrects a recorded set using exactly the measurements allowed by its tracking type. */
export function SetEditDialog({ exercise, set, isSaving, onOpenChange, onSave }: SetEditDialogProps): JSX.Element {
    const [weightKg, setWeightKg] = useState('');
    const [reps, setReps] = useState('');
    const [durationSeconds, setDurationSeconds] = useState('');
    const [distanceM, setDistanceM] = useState('');
    const [rpe, setRpe] = useState('');
    const [isWarmup, setWarmup] = useState(false);

    useEffect(() => {
        setWeightKg(numberDraft(set?.weightKg));
        setReps(numberDraft(set?.reps));
        setDurationSeconds(numberDraft(set?.durationSeconds));
        setDistanceM(numberDraft(set?.distanceM));
        setRpe(numberDraft(set?.rpe));
        setWarmup(set?.isWarmup ?? false);
    }, [set]);

    if (!exercise || !set) return <Dialog open={false} onOpenChange={onOpenChange} />;

    const save = (): void => {
        const patch: PatchSetRequest = { isWarmup, rpe: optionalNumber(rpe) };
        if (exercise.trackingType === TrackingType.WeightReps) {
            patch.weightKg = optionalNumber(weightKg);
            patch.reps = requiredNumber(reps);
        }
        if (exercise.trackingType === TrackingType.Duration) patch.durationSeconds = requiredNumber(durationSeconds);
        if (exercise.trackingType === TrackingType.DistanceTime) {
            patch.distanceM = requiredNumber(distanceM);
            patch.durationSeconds = requiredNumber(durationSeconds);
        }
        onSave(patch);
    };
    const isValid =
        exercise.trackingType === TrackingType.WeightReps
            ? requiredNumber(reps) !== null
            : exercise.trackingType === TrackingType.Duration
              ? requiredNumber(durationSeconds) !== null
              : requiredNumber(distanceM) !== null && requiredNumber(durationSeconds) !== null;

    return (
        <Dialog open={set !== null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit set {set.setIndex}</DialogTitle>
                    <DialogDescription>{exercise.exercise.name}</DialogDescription>
                </DialogHeader>
                <div className='grid grid-cols-2 gap-3'>
                    {exercise.trackingType === TrackingType.WeightReps && (
                        <SetField label='Weight (kg)' value={weightKg} onChange={setWeightKg} step='0.25' />
                    )}
                    {exercise.trackingType === TrackingType.WeightReps && (
                        <SetField label='Reps' value={reps} onChange={setReps} required />
                    )}
                    {exercise.trackingType === TrackingType.Duration && (
                        <SetField label='Seconds' value={durationSeconds} onChange={setDurationSeconds} required />
                    )}
                    {exercise.trackingType === TrackingType.DistanceTime && (
                        <SetField label='Distance (m)' value={distanceM} onChange={setDistanceM} step='0.1' required />
                    )}
                    {exercise.trackingType === TrackingType.DistanceTime && (
                        <SetField label='Seconds' value={durationSeconds} onChange={setDurationSeconds} required />
                    )}
                    <SetField label='RPE' value={rpe} onChange={setRpe} step='0.5' min='0' max='10' />
                </div>
                <label className='flex min-h-9 items-center gap-2 text-sm text-muted-foreground'>
                    <Checkbox checked={isWarmup} onCheckedChange={checked => setWarmup(checked === true)} />
                    Warm-up set
                </label>
                <DialogFooter>
                    <Button variant='ghost' onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={!isValid || isSaving}>
                        {isSaving ? 'Saving…' : 'Save changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** One numeric measurement in the edit dialog. */
function SetField({
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
        <div className='space-y-1'>
            <Label className='text-xs text-muted-foreground'>
                {label}
                {required && <span className='text-destructive'> *</span>}
            </Label>
            <Input
                type='number'
                inputMode='decimal'
                value={value}
                onChange={event => onChange(event.target.value)}
                className='h-10'
                {...inputProps}
            />
        </div>
    );
}

/** Converts a nullable stored number into a controlled input value. */
function numberDraft(value: number | null | undefined): string {
    return value?.toString() ?? '';
}

/** Converts a filled numeric input into an optional API field. */
function optionalNumber(value: string): number | null {
    const parsed = Number(value);
    return value.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
}

/** Converts a required numeric input into its API value. */
function requiredNumber(value: string): number | null {
    return optionalNumber(value);
}
