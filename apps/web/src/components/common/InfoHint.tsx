import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type InfoHintProps = {
    /** Describes the hint for screen readers and for a control with no visible text. */
    label: string;
    children: React.ReactNode;
    className?: string;
};

/** A tooltip that also opens on tap, so the hint is reachable without a pointer to hover with. */
export function InfoHint({ label, children, className }: InfoHintProps): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const wasOpenBeforePress = useRef(false);
    return (
        <Tooltip open={isOpen} onOpenChange={setOpen}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    // A tap closes the tooltip on pointer-down before the click lands, so the
                    // pre-press state is what decides whether the click opens or dismisses it.
                    onPointerDown={() => {
                        wasOpenBeforePress.current = isOpen;
                    }}
                    onClick={() => setOpen(!wasOpenBeforePress.current)}
                    className={cn(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        className,
                    )}
                >
                    <Info className="h-4 w-4" aria-hidden />
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-[17rem] text-xs leading-relaxed">
                {children}
            </TooltipContent>
        </Tooltip>
    );
}
