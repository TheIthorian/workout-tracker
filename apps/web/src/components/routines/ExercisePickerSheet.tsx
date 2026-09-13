import { useState, type ChangeEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useDebounce } from '@/hooks/use-debounce';
import { useCreateExercise, useExercises } from '@/hooks/use-exercises';
import { TRACKING_TYPE_META, TrackingType, type Exercise } from '@/models/exercise';

type ExercisePickerSheetProps = {
    workspaceId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the chosen (or just-created) exercise; the sheet stays open so several can be added in a row. */
    onPick: (exercise: Exercise) => void;
    /** True while a pick is being added to the routine; disables rows and the create button so a double-tap can't add twice. */
    isAdding: boolean;
};

/**
 * Searches the library (catalog + custom) from inside the editor, with an inline "create" row when
 * the movement is missing — leaving the routine to go make an exercise and coming back is exactly
 * the trip this avoids.
 */
export function ExercisePickerSheet({
    workspaceId,
    open,
    onOpenChange,
    onPick,
    isAdding,
}: ExercisePickerSheetProps): JSX.Element {
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [newTrackingType, setNewTrackingType] = useState<TrackingType>(TrackingType.WeightReps);
    const debouncedSetSearch = useDebounce((value: string) => setSearch(value.trim()), 250);

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useExercises({ workspaceId, search });
    const createExercise = useCreateExercise({ workspaceId });

    const exercises = data?.pages.flatMap((page) => page.data) ?? [];
    const trimmed = searchInput.trim();
    const hasExactMatch = exercises.some((exercise) => exercise.name.toLowerCase() === trimmed.toLowerCase());

    const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setSearchInput(event.target.value);
        debouncedSetSearch(event.target.value);
    };

    const handleCreate = (): void => {
        createExercise.mutate(
            { name: trimmed, trackingType: newTrackingType },
            {
                onSuccess: (created) => {
                    onPick(created);
                    setSearchInput('');
                    setSearch('');
                },
            },
        );
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side='bottom' className='flex h-[85vh] flex-col rounded-t-2xl p-0 md:mx-auto md:max-w-2xl'>
                <SheetHeader className='px-4 pt-4 text-left'>
                    <SheetTitle>Add exercise</SheetTitle>
                    <SheetDescription>Tap to add. Search for a movement, or create one on the spot.</SheetDescription>
                </SheetHeader>
                <div className='relative px-4 pt-2'>
                    <Search
                        className='pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground'
                        aria-hidden
                    />
                    <Input
                        autoFocus
                        value={searchInput}
                        onChange={handleSearchChange}
                        placeholder='Search exercises'
                        aria-label='Search exercises'
                        className='h-11 pl-9'
                    />
                </div>
                <div className='flex-1 overflow-y-auto px-4 pb-6 pt-3'>
                    {isLoading ? (
                        <LoadingState label='Loading exercises…' />
                    ) : (
                        <ul className='space-y-2'>
                            {trimmed.length > 0 && !hasExactMatch && (
                                <li className='flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3'>
                                    <span className='min-w-0 flex-1 text-sm'>
                                        Create <span className='font-medium'>"{trimmed}"</span>
                                    </span>
                                    <Select
                                        value={newTrackingType}
                                        onValueChange={(value) => setNewTrackingType(value as TrackingType)}
                                    >
                                        <SelectTrigger className='h-9 w-[10.5rem]' aria-label='Tracked by'>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.values(TrackingType).map((type) => (
                                                <SelectItem key={type} value={type}>
                                                    {TRACKING_TYPE_META[type].label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        size='sm'
                                        className='gap-1'
                                        onClick={handleCreate}
                                        disabled={createExercise.isPending || isAdding}
                                    >
                                        <Plus className='h-4 w-4' aria-hidden />
                                        {createExercise.isPending ? 'Creating…' : 'Create & add'}
                                    </Button>
                                </li>
                            )}
                            {exercises.map((exercise) => {
                                const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];
                                return (
                                    <li key={exercise.id}>
                                        <button
                                            type='button'
                                            onClick={() => onPick(exercise)}
                                            disabled={isAdding}
                                            className='flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
                                        >
                                            <span className='min-w-0 flex-1 truncate font-medium'>{exercise.name}</span>
                                            {exercise.isCatalog && (
                                                <Badge variant='outline' className='shrink-0'>
                                                    Catalog
                                                </Badge>
                                            )}
                                            <Badge variant='secondary' className='shrink-0 gap-1 whitespace-nowrap'>
                                                <Icon className='h-3 w-3' aria-hidden />
                                                {label}
                                            </Badge>
                                        </button>
                                    </li>
                                );
                            })}
                            {hasNextPage && (
                                <li className='pt-2 text-center'>
                                    <Button
                                        variant='outline'
                                        onClick={() => fetchNextPage()}
                                        disabled={isFetchingNextPage}
                                    >
                                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                                    </Button>
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
