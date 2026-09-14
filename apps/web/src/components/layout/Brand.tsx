import { Dumbbell } from 'lucide-react';
import { APP_NAME } from '@/constants';

/** The product wordmark, shared by the app and account screens. */
export function Brand(): JSX.Element {
    return (
        <span className="inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Dumbbell className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="text-2xl font-semibold tracking-[-0.06em]">
                {APP_NAME}
                <span className="text-primary">.</span>
            </span>
        </span>
    );
}
