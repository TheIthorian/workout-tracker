import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { StepperField } from '@/components/common/StepperField';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatSessionClock } from '@/models/session';

type RestTimeSheetProps = {
    open: boolean;
    exerciseName: string;
    /** The rest in force when the sheet opens. */
    restSeconds: number;
    isSaving: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (restSeconds: number) => void;
};

const REST_STEP_SECONDS = 15;
const MAX_REST_SECONDS = 3600;
const QUICK_PICKS_SECONDS = [0, 30, 60, 90, 120, 180];

/** A bottom sheet for choosing an exercise's rest between sets, sized for a thumb mid-workout. */
export function RestTimeSheet({
    open,
    exerciseName,
    restSeconds,
    isSaving,
    onOpenChange,
    onSave,
}: RestTimeSheetProps): JSX.Element {
    const [draft, setDraft] = useState<number | null>(restSeconds);

    useEffect(() => {
        if (open) setDraft(restSeconds);
    }, [open, restSeconds]);

    const value = draft ?? 0;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="rounded-t-2xl md:mx-auto md:max-w-md">
                <SheetHeader className="text-left">
                    <SheetTitle className="flex items-center gap-2">
                        <Timer className="h-5 w-5" aria-hidden />
                        Rest between sets
                    </SheetTitle>
                    <SheetDescription>
                        {exerciseName}. Applies every time you train it, in any routine.
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                    <StepperField
                        label="Rest"
                        value={value}
                        onChange={(next) => setDraft(next)}
                        step={REST_STEP_SECONDS}
                        max={MAX_REST_SECONDS}
                        format={describeRest}
                    />
                    <div className="grid grid-cols-3 gap-2">
                        {QUICK_PICKS_SECONDS.map((seconds) => (
                            <Button
                                key={seconds}
                                type="button"
                                variant={value === seconds ? 'default' : 'secondary'}
                                className="h-11"
                                onClick={() => setDraft(seconds)}
                            >
                                {describeRest(seconds)}
                            </Button>
                        ))}
                    </div>
                    <Button className="h-12 w-full" disabled={isSaving} onClick={() => onSave(value)}>
                        {isSaving ? 'Saving…' : 'Save rest time'}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

/** Zero is "no timer", which reads better than 0:00. */
function describeRest(seconds: number): string {
    return seconds === 0 ? 'Off' : formatSessionClock(seconds);
}
