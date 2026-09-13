import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { useSessions } from '@/hooks/use-sessions';

/** The session-history index. Individual session pages retain their full set details. */
export default function HistoryPage(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const navigate = useNavigate();
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessions({ workspaceId });
    const sessions = (data?.pages.flatMap(page => page.data) ?? []).filter(session => session.completedAt !== null);

    return (
        <div className='mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10'>
            <h1 className='font-heading text-3xl'>History</h1>
            <p className='mt-1.5 text-muted-foreground'>Your completed workouts and their recorded sets.</p>
            <div className='mt-8'>
                {isLoading ? (
                    <LoadingState label='Loading history…' />
                ) : sessions.length === 0 ? (
                    <EmptyState
                        title='No workouts yet'
                        description='Complete a workout and it will appear here.'
                        actionLabel='Start a workout'
                        onAction={() => navigate(`/workspaces/${workspaceId}/today`)}
                    />
                ) : (
                    <>
                        <ul className='space-y-2'>
                            {sessions.map(session => (
                                <li key={session.id}>
                                    <Link
                                        to={`/workspaces/${workspaceId}/sessions/${session.id}`}
                                        className='flex min-h-[4rem] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                                    >
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate font-medium'>{session.name}</span>
                                            <span className='block text-xs text-muted-foreground'>
                                                {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(session.startedAt))} · {session.setCount} sets
                                            </span>
                                        </span>
                                        <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        {hasNextPage && (
                            <div className='mt-4 text-center'>
                                <Button variant='outline' onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
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
