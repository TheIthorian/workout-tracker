import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Dumbbell, Play, Plus } from 'lucide-react';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { StartWorkoutButton } from '@/components/sessions/StartWorkoutButton';
import { Button } from '@/components/ui/button';
import { useRoutines } from '@/hooks/use-routines';
import { useActiveSession, useStartSession } from '@/hooks/use-sessions';
import { getStartWorkoutBlockedReason } from '@/lib/start-workout';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/** Starts or resumes training, with quick access to saved routines and the library. */
export default function TodayPage(): JSX.Element {
    const { workspaceId } = useWorkspace();
    const navigate = useNavigate();
    const { user } = useAuth();
    const active = useActiveSession({ workspaceId });
    const routinesQuery = useRoutines({ workspaceId });
    const startSession = useStartSession({ workspaceId });
    const routines =
        routinesQuery.data?.pages.flatMap((page) => page.data).filter((routine) => !routine.archivedAt) ?? [];
    const session = active.data?.session;
    const startBlockedReason = getStartWorkoutBlockedReason({ hasActiveSession: Boolean(session) });
    const start = (routineId?: string): void => {
        startSession.mutate(routineId ? { routineId } : {}, {
            onSuccess: (created) => navigate(`/sessions/${created.id}`),
            // Another tab or an MCP client can open a workout between this page's last read and the
            // tap. The shared HTTP client has already surfaced the problem detail, so all that is
            // left is to catch this page up so the controls explain themselves from now on.
            onError: () => void active.refetch(),
        });
    };
    return (
        <div className="page-shell">
            <div className="mb-8">
                <p className="eyebrow mb-3">One workout at a time</p>
                <h1 className="page-title">
                    A little stronger today<span className="text-primary">.</span>
                </h1>
                <p className="mt-3 text-muted-foreground">
                    {user?.displayName ? `Good to see you, ${user.displayName.split(' ')[0]}. ` : ''}Let’s make some
                    time for you.
                </p>
            </div>
            {active.isLoading || routinesQuery.isLoading ? (
                <LoadingState label="Getting your training space ready…" />
            ) : active.isError || routinesQuery.isError ? (
                <EmptyState
                    title="Let’s try that again"
                    description="We couldn’t load your workouts. Check your connection and try again."
                    actionLabel="Try again"
                    onAction={() => {
                        void active.refetch();
                        void routinesQuery.refetch();
                    }}
                />
            ) : (
                <>
                    <section className="training-banner p-7 sm:p-10">
                        <div className="training-rings sm:right-12 sm:top-[-30px]" aria-hidden />
                        <div className="relative max-w-lg">
                            <span className="mb-7 flex items-center gap-2 text-xs font-medium text-[#c8dfac]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#c8dfac]" />
                                {session ? 'WORKOUT IN PROGRESS' : 'YOUR NEXT SESSION'}
                            </span>
                            <h2 className="text-3xl sm:text-4xl">
                                {session ? session.name : 'Show up. Set your pace.'}
                            </h2>
                            <p className="mt-3 text-sm leading-relaxed text-[#d0dfd5]">
                                {session
                                    ? `${session.state.progress.loggedSets} working sets logged. Pick up right where you left off.`
                                    : 'Start with a blank workout and add movements as you go. You bring the effort. We’ll keep track.'}
                            </p>
                            <Button
                                className="mt-7 bg-[#d5e8b5] text-[#234d3d] hover:bg-[#e0edcb]"
                                disabled={startSession.isPending}
                                onClick={() => (session ? navigate(`/sessions/${session.id}`) : start())}
                            >
                                {session ? <ArrowRight /> : <Plus />}
                                {startSession.isPending ? 'Starting…' : session ? 'Resume workout' : 'Start a workout'}
                            </Button>
                        </div>
                    </section>
                    <div className="mt-9 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <section>
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h2 className="text-xl">Your routines</h2>
                                <Link to="/routines" className="py-3 text-xs font-medium text-primary">
                                    View all <span aria-hidden>→</span>
                                </Link>
                            </div>
                            {routines.length ? (
                                <ul className="overflow-hidden rounded-2xl border bg-card">
                                    {routines.map((routine) => (
                                        <li
                                            key={routine.id}
                                            className="flex items-center gap-4 border-b p-4 last:border-0"
                                        >
                                            <span className="exercise-icon">
                                                <Dumbbell className="h-5 w-5" />
                                            </span>
                                            <Link to={`/routines/${routine.id}`} className="min-w-0 flex-1">
                                                <span className="block break-words text-sm font-semibold">
                                                    {routine.name}
                                                </span>
                                                <span className="mt-1 block text-xs text-muted-foreground">
                                                    {routine.exerciseCount}{' '}
                                                    {routine.exerciseCount === 1 ? 'movement' : 'movements'}
                                                </span>
                                            </Link>
                                            <StartWorkoutButton
                                                size="sm"
                                                variant="outline"
                                                blockedReason={startBlockedReason}
                                                disabled={startSession.isPending}
                                                onStart={() => start(routine.id)}
                                                aria-label={`Start ${routine.name}`}
                                            >
                                                <Play />
                                                <span className="hidden sm:inline">Start</span>
                                            </StartWorkoutButton>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <EmptyState
                                    title="Make your go-to workout"
                                    description="Group your favorite movements into a routine, ready for the next time you train."
                                    actionLabel="Create a routine"
                                    onAction={() => navigate('/routines')}
                                />
                            )}
                        </section>
                        <Link to="/exercises" className="group rounded-2xl border bg-secondary/50 p-6">
                            <BookOpen className="mb-6 h-6 w-6 text-primary" aria-hidden />
                            <h2 className="text-xl">Find your next movement</h2>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                Your exercise library and technique notes, all in one place.
                            </p>
                            <span className="mt-6 flex items-center justify-between text-sm font-medium text-primary">
                                Explore the library
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </span>
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
}
