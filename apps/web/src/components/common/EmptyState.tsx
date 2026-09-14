import { Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}

/** An inviting next step when there is no content yet. */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps): JSX.Element {
    return (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary">
                <Sprout className="h-6 w-6" aria-hidden />
            </span>
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
            {actionLabel && onAction && (
                <Button className="mt-4" onClick={onAction}>
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
