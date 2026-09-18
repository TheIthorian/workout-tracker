import { RefreshCw, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Shown instead of the sign-in page when the API could not be reached and the session is therefore
 * unknown. Losing signal mid-workout must not look like being signed out: there is nothing to sign
 * in again for, and doing so would throw away the page someone was on.
 */
export function ConnectionLost({ onRetry }: { onRetry: () => Promise<void> }): JSX.Element {
    const [isRetrying, setRetrying] = useState(false);

    const retry = async (): Promise<void> => {
        setRetrying(true);

        try {
            await onRetry();
        } finally {
            setRetrying(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
                <h1 className="text-lg font-semibold">Can’t reach the server</h1>
                <p className="text-sm text-muted-foreground">
                    You’re still signed in. Check your connection and try again.
                </p>
            </div>
            <Button size="lg" className="min-w-40" disabled={isRetrying} onClick={() => void retry()}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden="true" />
                Try again
            </Button>
        </div>
    );
}
