import { Loader2 } from 'lucide-react';

/** An announced loading state that keeps the layout stable. */
export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40"
        >
            <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{label}</span>
            </div>
        </div>
    );
}
