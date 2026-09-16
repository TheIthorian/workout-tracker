import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type StepperFieldProps = {
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    step: number;
    min?: number;
    max?: number;
    /** Renders the value read-only in this form instead of as an editable number input. */
    format?: (value: number) => string;
    required?: boolean;
    disabled?: boolean;
    /** Rendered beside the label, for a field whose name does not explain itself. */
    hint?: ReactNode;
};

const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 120;

/**
 * A number field driven by two large tap targets, for gym use where a keyboard is a chore. Holding
 * either button repeats the step; the value itself stays typeable unless `format` is given.
 */
export function StepperField({
    label,
    value,
    onChange,
    step,
    min = 0,
    max,
    format,
    required = false,
    disabled = false,
    hint,
}: StepperFieldProps): JSX.Element {
    const holdTimer = useRef<number | null>(null);
    const holdInterval = useRef<number | null>(null);
    const latest = useRef({ value, onChange });
    latest.current = { value, onChange };
    // Typing goes through a text draft so a half-typed "2." is not snapped back to 2 mid-keystroke.
    const [draft, setDraft] = useState(value?.toString() ?? '');

    useEffect(() => {
        if (parseNumber(draft) !== value) setDraft(value?.toString() ?? '');
    }, [draft, value]);

    useEffect(() => stopHold, []);

    const nudge = (direction: 1 | -1): void => {
        const current = latest.current.value ?? 0;
        const next = clamp(roundToStep(current + direction * step, step), min, max);
        if (next !== current) latest.current.onChange(next);
    };

    const startHold =
        (direction: 1 | -1) =>
        (event: PointerEvent<HTMLButtonElement>): void => {
            if (disabled || event.button !== 0) return;
            nudge(direction);
            stopHold();
            holdTimer.current = window.setTimeout(() => {
                holdInterval.current = window.setInterval(() => nudge(direction), HOLD_INTERVAL_MS);
            }, HOLD_DELAY_MS);
        };

    // A pointer press already stepped once; only a keyboard-originated click (detail 0) still needs to.
    const keyboardNudge =
        (direction: 1 | -1) =>
        (event: MouseEvent<HTMLButtonElement>): void => {
            if (event.detail === 0) nudge(direction);
        };

    function stopHold(): void {
        if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
        if (holdInterval.current !== null) window.clearInterval(holdInterval.current);
        holdTimer.current = null;
        holdInterval.current = null;
    }

    const atMin = value !== null && value <= min;
    const atMax = max !== undefined && value !== null && value >= max;

    return (
        <div className="space-y-1.5">
            {/* Every label row reserves the hint's height, so a hinted field still lines up with its neighbours. */}
            <div className="flex min-h-8 items-center gap-1">
                <Label className="text-xs text-muted-foreground">
                    {label}
                    {required && <span className="text-destructive"> *</span>}
                </Label>
                {hint}
            </div>
            <div className="flex items-stretch gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-14 w-14 shrink-0 rounded-xl text-lg"
                    aria-label={`Decrease ${label}`}
                    disabled={disabled || atMin}
                    onPointerDown={startHold(-1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                    onClick={keyboardNudge(-1)}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <Minus className="h-5 w-5" aria-hidden />
                </Button>
                {format ? (
                    <output className="flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl border border-input bg-background font-heading text-2xl tabular-nums">
                        {value === null ? '—' : format(value)}
                    </output>
                ) : (
                    <Input
                        type="number"
                        inputMode="decimal"
                        aria-label={label}
                        value={draft}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            onChange(parseNumber(event.target.value));
                        }}
                        className="h-14 min-w-0 flex-1 rounded-xl bg-background text-center font-heading text-2xl tabular-nums"
                    />
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-14 w-14 shrink-0 rounded-xl text-lg"
                    aria-label={`Increase ${label}`}
                    disabled={disabled || atMax}
                    onPointerDown={startHold(1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                    onClick={keyboardNudge(1)}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <Plus className="h-5 w-5" aria-hidden />
                </Button>
            </div>
        </div>
    );
}

/** Parses a typed value, treating blank or junk as unset rather than zero. */
function parseNumber(raw: string): number | null {
    const parsed = Number(raw);
    return raw.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
}

/** Snaps a stepped value to the step's own precision so repeated 0.25s never drift into 0.7500001. */
function roundToStep(value: number, step: number): number {
    const decimals = (step.toString().split('.')[1] ?? '').length;
    return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number | undefined): number {
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, value));
}
