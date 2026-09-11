import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { useCreateExercise, useExercises } from '@/hooks/use-exercises';
import { toast } from '@/hooks/use-toast';
import { TRACKING_TYPE_META, TrackingType, type Exercise } from '@/models/exercise';

/**
 * The exercise library: a searchable, single-column list built to be scanned one-handed at the
 * gym. The library starts empty, so a fresh workspace's common first view is the create prompt,
 * not a blank list.
 */
export default function ExercisesListPage(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const navigate = useNavigate();

    const [isCreateOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [trackingType, setTrackingType] = useState<TrackingType>(TrackingType.WeightReps);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    // Trimmed once here, upstream of everywhere `search` is read (the query key, the request
    // filter, and `isSearching` below) — so those three can never disagree about whether a
    // whitespace-only box counts as "searching".
    const debouncedSetSearch = useDebounce((value: string) => setSearch(value.trim()), 300);

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useExercises({
        workspaceId,
        search,
    });
    const createExercise = useCreateExercise({ workspaceId });

    const exercises = data?.pages.flatMap(page => page.data) ?? [];
    const totalCount = data?.pages[0]?.totalCount ?? 0;
    const isSearching = search.length > 0;
    const hasNoExercisesAtAll = !isLoading && exercises.length === 0 && !isSearching;
    const hasNoSearchResults = !isLoading && exercises.length === 0 && isSearching;

    const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setSearchInput(event.target.value);
        debouncedSetSearch(event.target.value);
    };

    const handleClearSearch = (): void => {
        setSearchInput('');
        setSearch('');
    };

    const openCreateDialog = (): void => {
        setName('');
        setTrackingType(TrackingType.WeightReps);
        setCreateOpen(true);
    };

    const handleCreate = (): void => {
        createExercise.mutate(
            { name: name.trim(), trackingType },
            {
                onSuccess: created => {
                    toast({ title: 'Exercise created' });
                    setCreateOpen(false);
                    navigate(`/workspaces/${workspaceId}/exercises/${created.id}`);
                },
            },
        );
    };

    return (
        <div className='pb-6'>
            <div className='sticky top-0 z-20 border-b border-border bg-background/95 px-4 pb-4 pt-6 backdrop-blur-sm md:top-[4.5rem] md:px-8'>
                <div className='mx-auto flex max-w-2xl flex-wrap items-start justify-between gap-4'>
                    <div>
                        <h1 className='font-heading text-3xl text-foreground'>Exercises</h1>
                        <p className='mt-1.5 text-muted-foreground'>The movements you train.</p>
                    </div>
                    <Button onClick={openCreateDialog} className='gap-2'>
                        <Plus className='h-4 w-4' aria-hidden />
                        New exercise
                    </Button>
                </div>
                <div className='relative mx-auto mt-4 max-w-2xl'>
                    <Search
                        className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground'
                        aria-hidden
                    />
                    <Input
                        value={searchInput}
                        onChange={handleSearchChange}
                        placeholder='Search exercises'
                        aria-label='Search exercises'
                        className='h-11 pl-9'
                    />
                </div>
            </div>

            <div className='mx-auto max-w-2xl px-4 pt-6 md:px-8'>
                {isLoading ? (
                    <LoadingState label='Loading exercises…' />
                ) : hasNoExercisesAtAll ? (
                    <EmptyState
                        title='Build your exercise library'
                        description="Add the first movement you want to track. You'll be able to log sets against it right away."
                        actionLabel='Add exercise'
                        onAction={openCreateDialog}
                    />
                ) : hasNoSearchResults ? (
                    <div className='rounded-2xl border border-dashed border-border bg-card p-8 text-center'>
                        <h3 className='text-lg font-semibold tracking-tight'>No exercises match "{search}"</h3>
                        <p className='mt-2 text-sm text-muted-foreground'>Try a different name, or clear the search.</p>
                        <Button variant='ghost' className='mt-4' onClick={handleClearSearch}>
                            Clear search
                        </Button>
                    </div>
                ) : (
                    <>
                        <ul className='space-y-2'>
                            {exercises.map(exercise => (
                                <ExerciseRow key={exercise.id} exercise={exercise} workspaceId={workspaceId} />
                            ))}
                        </ul>

                        {hasNextPage && (
                            <div className='mt-4 flex flex-col items-center gap-2'>
                                <Button variant='outline' onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                                </Button>
                                <p className='text-xs text-muted-foreground'>
                                    Showing {exercises.length} of {totalCount}
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New exercise</DialogTitle>
                        <DialogDescription>
                            Give it a name and how you'll measure it — you can add setup notes and cues later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className='space-y-4'>
                        <div className='space-y-2'>
                            <Label htmlFor='exercise-name'>Name</Label>
                            <Input
                                id='exercise-name'
                                value={name}
                                maxLength={200}
                                placeholder='e.g. Barbell back squat'
                                onChange={event => setName(event.target.value)}
                            />
                        </div>
                        <div className='space-y-2'>
                            <Label htmlFor='exercise-tracking-type'>Tracked by</Label>
                            <Select
                                value={trackingType}
                                onValueChange={value => setTrackingType(value as TrackingType)}
                            >
                                <SelectTrigger id='exercise-tracking-type'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.values(TrackingType).map(type => (
                                        <SelectItem key={type} value={type}>
                                            {TRACKING_TYPE_META[type].label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant='ghost' onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={name.trim().length === 0 || createExercise.isPending}>
                            {createExercise.isPending ? 'Creating…' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** One row in the list: name, a tracking-type badge, and a link into the detail page. */
function ExerciseRow({ exercise, workspaceId }: { exercise: Exercise; workspaceId: string }): JSX.Element {
    const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];

    return (
        <li>
            <Link
                to={`/workspaces/${workspaceId}/exercises/${exercise.id}`}
                className='flex min-h-[3.5rem] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            >
                <span className='min-w-0 flex-1 truncate font-medium text-foreground'>{exercise.name}</span>
                <Badge variant='secondary' className='shrink-0 gap-1 whitespace-nowrap'>
                    <Icon className='h-3 w-3' aria-hidden />
                    {label}
                </Badge>
                <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden />
            </Link>
        </li>
    );
}
