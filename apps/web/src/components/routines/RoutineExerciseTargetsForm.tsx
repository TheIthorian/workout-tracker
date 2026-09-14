import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TRACKING_TYPE_META, TrackingType } from '@/models/exercise';
import type { PatchRoutineExerciseRequest, RoutineExercise } from '@/models/routine';

type RoutineExerciseTargetsFormProps = {
    slot: RoutineExercise;
    isSaving: boolean;
    onSave: (patch: PatchRoutineExerciseRequest) => void;
    onRemove: () => void;
};

type Draft = {
    targetSets: string;
    restSeconds: string;
    notes: string;
    targetReps: string;
    targetWeightKg: string;
    targetDurationSeconds: string;
    targetDistanceM: string;
};

/**
 * Edits one slot's targets. Which measurement fields appear follows the exercise's tracking type —
 * one form, a small switch, no hidden fields — and every value is typed in canonical units.
 *
 * Holds text drafts rather than numbers so a half-typed "62." is not rounded out from under the
 * user; parsing happens on save.
 */
export function RoutineExerciseTargetsForm({
    slot,
    isSaving,
    onSave,
    onRemove,
}: RoutineExerciseTargetsFormProps): JSX.Element {
    const [draft, setDraft] = useState<Draft>(() => toDraft(slot));

    // A different slot selected in the list means a fresh draft, not the previous slot's edits.
    useEffect(() => {
        setDraft(toDraft(slot));
    }, [slot]);

    const { label, icon: Icon } = TRACKING_TYPE_META[slot.exercise.trackingType];
    const set = (field: keyof Draft): ((value: string) => void) => {
        return (value: string) => setDraft((current) => ({ ...current, [field]: value }));
    };

    const handleSave = (): void => {
        const sets = parseInteger(draft.targetSets);
        onSave({
            targetSets: sets === null || sets < 1 ? 1 : sets,
            restSeconds: parseInteger(draft.restSeconds),
            notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
            ...(slot.exercise.trackingType === TrackingType.WeightReps && {
                targetReps: parseInteger(draft.targetReps),
                targetWeightKg: parseDecimal(draft.targetWeightKg),
            }),
            ...(slot.exercise.trackingType === TrackingType.Duration && {
                targetDurationSeconds: parseInteger(draft.targetDurationSeconds),
            }),
            ...(slot.exercise.trackingType === TrackingType.DistanceTime && {
                targetDistanceM: parseDecimal(draft.targetDistanceM),
                targetDurationSeconds: parseInteger(draft.targetDurationSeconds),
            }),
        });
    };

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-lg font-semibold">{slot.exercise.name}</h2>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon className="h-3 w-3" aria-hidden />
                    {label}
                    {slot.exercise.archivedAt && <span className="ml-2 text-destructive">Archived exercise</span>}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <NumberField
                    id="target-sets"
                    label="Sets"
                    value={draft.targetSets}
                    onChange={set('targetSets')}
                    min={1}
                />
                <NumberField
                    id="rest-seconds"
                    label="Rest (s)"
                    value={draft.restSeconds}
                    onChange={set('restSeconds')}
                />

                {slot.exercise.trackingType === TrackingType.WeightReps && (
                    <>
                        <NumberField
                            id="target-reps"
                            label="Reps"
                            value={draft.targetReps}
                            onChange={set('targetReps')}
                        />
                        <NumberField
                            id="target-weight"
                            label="Weight (kg)"
                            value={draft.targetWeightKg}
                            onChange={set('targetWeightKg')}
                            step="0.5"
                        />
                    </>
                )}
                {slot.exercise.trackingType === TrackingType.Duration && (
                    <NumberField
                        id="target-duration"
                        label="Duration (s)"
                        value={draft.targetDurationSeconds}
                        onChange={set('targetDurationSeconds')}
                    />
                )}
                {slot.exercise.trackingType === TrackingType.DistanceTime && (
                    <>
                        <NumberField
                            id="target-distance"
                            label="Distance (m)"
                            value={draft.targetDistanceM}
                            onChange={set('targetDistanceM')}
                            step="10"
                        />
                        <NumberField
                            id="target-duration"
                            label="Time (s)"
                            value={draft.targetDurationSeconds}
                            onChange={set('targetDurationSeconds')}
                        />
                    </>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="slot-notes">Notes</Label>
                <Textarea
                    id="slot-notes"
                    value={draft.notes}
                    maxLength={1000}
                    rows={2}
                    placeholder="e.g. pause at the bottom"
                    onChange={(event) => set('notes')(event.target.value)}
                />
            </div>

            <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" className="gap-2 text-destructive" onClick={onRemove} disabled={isSaving}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Remove
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </div>
    );
}

type NumberFieldProps = {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    min?: number;
    step?: string;
};

function NumberField({ id, label, value, onChange, min = 0, step = '1' }: NumberFieldProps): JSX.Element {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type="number"
                inputMode="decimal"
                min={min}
                step={step}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="h-11 text-base"
            />
        </div>
    );
}

function toDraft(slot: RoutineExercise): Draft {
    const text = (value: number | null): string => (value === null ? '' : String(value));
    return {
        targetSets: String(slot.targetSets),
        restSeconds: text(slot.restSeconds),
        notes: slot.notes ?? '',
        targetReps: text(slot.targetReps),
        targetWeightKg: text(slot.targetWeightKg),
        targetDurationSeconds: text(slot.targetDurationSeconds),
        targetDistanceM: text(slot.targetDistanceM),
    };
}

function parseInteger(value: string): number | null {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
}

function parseDecimal(value: string): number | null {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
}
