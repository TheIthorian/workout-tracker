import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Dumbbell, Play, Plus } from 'lucide-react';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { useRoutines } from '@/hooks/use-routines';
import { useActiveSession, useStartSession } from '@/hooks/use-sessions';
import { toast } from '@/hooks/use-toast';

/** The workout entry point: resume the current session or begin from a routine or a blank slate. */
export default function TodayPage(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const navigate = useNavigate();
    const { data: active, isLoading: isActiveLoading } = useActiveSession({ workspaceId });
    const { data: routinesData, isLoading: areRoutinesLoading } = useRoutines({ workspaceId });
    const startSession = useStartSession({ workspaceId });
    const routines = routinesData?.pages.flatMap(page => page.data).filter(routine => routine.archivedAt === null) ?? [];

    const start = (routineId?: string): void => {
        startSession.mutate(
            routineId ? { routineId } : {},
            {
                onSuccess: session => navigate(`/workspaces/${workspaceId}/sessions/${session.id}`),
                onError: error => toast({ title: 'Could not start workout', description: error.message, variant: 'destructive' }),
            },
        );
    };

    if (isActiveLoading || areRoutinesLoading) {
        return (
            <div className='mx-auto max-w-3xl px-4 py-10 md:px-8'>
                <LoadingState label='Getting today ready…' />
            </div>
        );
    }

    return (
        <div className='mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10'>
            <p className='text-sm font-medium text-primary'>Today</p>
            <h1 className='font-heading text-4xl'>Ready to train?</h1>
            <p className='mt-2 max-w-xl text-muted-foreground'>Pick up where you left off, or choose how you want to train.</p>

            {active?.session ? (
                <section className='mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6'>
                    <div className='flex flex-wrap items-center justify-between gap-4'>
                        <div>
                            <p className='text-sm font-medium text-primary'>Workout in progress</p>
                            <h2 className='font-heading text-2xl'>{active.session.name}</h2>
                            <p className='mt-1 text-sm text-muted-foreground'>
                                {active.session.state.progress.loggedSets} working sets logged
                            </p>
                        </div>
                        <Button onClick={() => navigate(`/workspaces/${workspaceId}/sessions/${active.session!.id}`)} className='gap-2'>
                            Resume workout
                            <ArrowRight className='h-4 w-4' aria-hidden />
                        </Button>
                    </div>
                </section>
            ) : (
                <>
                    <section className='mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6'>
                        <div className='flex flex-wrap items-center justify-between gap-4'>
                            <div className='flex items-center gap-3'>
                                <span className='grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary'>
                                    <Dumbbell className='h-5 w-5' aria-hidden />
                                </span>
                                <div>
                                    <h2 className='font-heading text-xl'>Start a blank workout</h2>
                                    <p className='text-sm text-muted-foreground'>Add exercises as you go.</p>
                                </div>
                            </div>
                            <Button onClick={() => start()} disabled={startSession.isPending} className='gap-2'>
                                <Plus className='h-4 w-4' aria-hidden />
                                Start blank
                            </Button>
                        </div>
                    </section>

                    <section className='mt-8'>
                        <h2 className='font-heading text-2xl'>Start from a routine</h2>
                        {routines.length === 0 ? (
                            <p className='mt-2 text-sm text-muted-foreground'>Create a routine to have it ready here next time.</p>
                        ) : (
                            <ul className='mt-3 space-y-2'>
                                {routines.map(routine => (
                                    <li key={routine.id} className='flex items-center gap-3 rounded-xl border border-border bg-card p-3'>
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate font-medium'>{routine.name}</span>
                                            <span className='text-xs text-muted-foreground'>
                                                {routine.exerciseCount === 1 ? '1 exercise' : `${routine.exerciseCount} exercises`}
                                            </span>
                                        </span>
                                        <Button size='sm' variant='outline' onClick={() => start(routine.id)} disabled={startSession.isPending} className='gap-1.5'>
                                            <Play className='h-3.5 w-3.5' aria-hidden />
                                            Start
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
