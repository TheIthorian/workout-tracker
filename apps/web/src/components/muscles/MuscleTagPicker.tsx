import { cn } from '@/lib/utils';
import {
    BODY_REGION_LABEL,
    MUSCLE_META,
    MUSCLE_REGIONS,
    MuscleGroup,
    type MuscleEngagementValue,
} from '@/models/muscle';

/** How one muscle is tagged on the exercise being edited. */
enum TagState {
    Untagged = 'untagged',
    Primary = 'primary',
    Secondary = 'secondary',
}

/**
 * Tags what an exercise works, grouped by area of the body.
 *
 * Each chip cycles untagged → primary → secondary → untagged rather than offering two separate
 * controls per muscle: it halves the number of tap targets on a phone, and the three states are
 * distinguishable without reading, which matters for a form filled in at the gym.
 */
export function MuscleTagPicker({
    value,
    onChange,
    disabled,
}: {
    value: MuscleEngagementValue;
    onChange: (next: MuscleEngagementValue) => void;
    disabled?: boolean;
}): JSX.Element {
    const cycle = (muscle: MuscleGroup): void => {
        const primary = value.primaryMuscles.filter((other) => other !== muscle);
        const secondary = value.secondaryMuscles.filter((other) => other !== muscle);

        if (stateOf({ muscle, value }) === TagState.Untagged)
            onChange({ primaryMuscles: [...primary, muscle], secondaryMuscles: secondary });
        else if (stateOf({ muscle, value }) === TagState.Primary)
            onChange({ primaryMuscles: primary, secondaryMuscles: [...secondary, muscle] });
        else onChange({ primaryMuscles: primary, secondaryMuscles: secondary });
    };

    return (
        <div role="group" aria-label="Muscles worked" className="space-y-4">
            <p className="text-xs text-muted-foreground">
                Tap once for a muscle the movement is <span className="font-medium text-foreground">for</span>, twice
                for one it <span className="font-medium text-foreground">also works</span>, and again to clear it.
            </p>
            {MUSCLE_REGIONS.map(({ region, muscles }) => (
                <div key={region}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {BODY_REGION_LABEL[region]}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {muscles.map((muscle) => {
                            const state = stateOf({ muscle, value });

                            return (
                                <button
                                    key={muscle}
                                    type="button"
                                    disabled={disabled}
                                    aria-pressed={state !== TagState.Untagged}
                                    onClick={() => cycle(muscle)}
                                    className={cn(
                                        'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                                        state === TagState.Primary &&
                                            'border-primary bg-primary text-primary-foreground',
                                        state === TagState.Secondary && 'border-primary bg-primary/15 text-foreground',
                                        state === TagState.Untagged && 'border-border bg-card hover:bg-secondary',
                                    )}
                                >
                                    {MUSCLE_META[muscle].label}
                                    <span className="sr-only">
                                        {state === TagState.Primary
                                            ? ', primary target'
                                            : state === TagState.Secondary
                                              ? ', also worked'
                                              : ', not tagged'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function stateOf({ muscle, value }: { muscle: MuscleGroup; value: MuscleEngagementValue }): TagState {
    if (value.primaryMuscles.includes(muscle)) return TagState.Primary;
    if (value.secondaryMuscles.includes(muscle)) return TagState.Secondary;

    return TagState.Untagged;
}
