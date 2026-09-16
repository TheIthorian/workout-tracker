import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { START_WORKOUT_BLOCKED_MESSAGES, type StartWorkoutBlockedReason } from '@/lib/start-workout';

type StartWorkoutButtonProps = Omit<ButtonProps, 'onClick'> & {
    blockedReason: StartWorkoutBlockedReason | null;
    onStart: () => void;
    children: ReactNode;
};

/**
 * A start control that says why it is unavailable rather than leaving a greyed-out button
 * unexplained.
 *
 * A pointer or keyboard user gets a tooltip; a tap gets the same sentence as a toast, because
 * Radix tooltips never open from touch and this app is used one-handed on a phone.
 */
export function StartWorkoutButton({
    blockedReason,
    onStart,
    children,
    disabled,
    ...props
}: StartWorkoutButtonProps): JSX.Element {
    const button = (
        <Button {...props} disabled={disabled === true || blockedReason !== null} onClick={onStart}>
            {children}
        </Button>
    );

    if (blockedReason === null) return button;

    const message = START_WORKOUT_BLOCKED_MESSAGES[blockedReason];

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* The disabled button drops its own pointer events, so the wrapper carries them. */}
                <span
                    className="inline-flex"
                    tabIndex={0}
                    onClick={() => toast({ title: 'Not just yet', description: message })}
                >
                    {button}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{message}</TooltipContent>
        </Tooltip>
    );
}
