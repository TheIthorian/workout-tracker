import { Link, useNavigate } from 'react-router-dom';
import { formatDate } from '@/lib/date-format';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { useSessions } from '@/hooks/use-sessions';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/** The session-history index. Individual session pages retain their full set details. */
export default function HistoryPage(): JSX.Element {
    const { workspaceId } = useWorkspace();
    const navigate = useNavigate();
    const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessions({
        workspaceId,
    });
    const sessions = (data?.pages.flatMap((page) => page.data) ?? []).filter((session) => session.completedAt !== null);

    return (
        <div className="page-shell max-w-4xl">
            <p className="eyebrow mb-3">Look how far you’ve come</p>
            <h1 className="page-title">Your history.</h1>
            <p className="mt-1.5 text-muted-foreground">Your completed workouts and their recorded sets.</p>
            <div className="mt-8">
                {isLoading ? (
                    <LoadingState label="Loading history…" />
                ) : isError ? (
                    <EmptyState
                        title="Your history couldn’t load"
                        description="Check your connection and try again."
                        actionLabel="Try again"
                        onAction={() => void refetch()}
                    />
                ) : sessions.length === 0 ? (
                    <EmptyState
                        title="No workouts yet"
                        description="Complete a workout and it will appear here."
                        actionLabel="Start a workout"
                        onAction={() => navigate('/today')}
                    />
                ) : (
                    <>
                        <ul className="space-y-2">
                            {sessions.map((session) => (
                                <li key={session.id}>
                                    <Link
                                        to={`/sessions/${session.id}`}
                                        className="flex min-h-[4rem] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">{session.name}</span>
                                            <span className="block text-xs text-muted-foreground">
                                                {formatDate(session.startedAt)} · {session.setCount} sets
                                            </span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        {hasNextPage && (
                            <div className="mt-4 text-center">
                                <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
