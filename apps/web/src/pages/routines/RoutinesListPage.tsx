import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
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
import { useDebounce } from '@/hooks/use-debounce';
import { useCreateRoutine, useRoutines } from '@/hooks/use-routines';
import { toast } from '@/hooks/use-toast';
import type { Routine } from '@/models/routine';

/** The workspace's routines: a searchable single-column list, with creation leading straight into the editor. */
export default function RoutinesListPage(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const navigate = useNavigate();

    const [isCreateOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debouncedSetSearch = useDebounce((value: string) => setSearch(value.trim()), 300);

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useRoutines({ workspaceId, search });
    const createRoutine = useCreateRoutine({ workspaceId });

    const routines = data?.pages.flatMap((page) => page.data) ?? [];
    const totalCount = data?.pages[0]?.totalCount ?? 0;
    const isSearching = search.length > 0;
    const hasNoRoutinesAtAll = !isLoading && routines.length === 0 && !isSearching;
    const hasNoSearchResults = !isLoading && routines.length === 0 && isSearching;

    const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setSearchInput(event.target.value);
        debouncedSetSearch(event.target.value);
    };

    const openCreateDialog = (): void => {
        setName('');
        setCreateOpen(true);
    };

    const handleCreate = (): void => {
        createRoutine.mutate(
            { name: name.trim() },
            {
                onSuccess: (created) => {
                    toast({ title: 'Routine created' });
                    setCreateOpen(false);
                    navigate(`/workspaces/${workspaceId}/routines/${created.id}`);
                },
            },
        );
    };

    return (
        <div className="pb-6">
            <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 pb-4 pt-6 backdrop-blur-sm md:top-[4.5rem] md:px-8">
                <div className="mx-auto flex max-w-2xl flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="font-heading text-3xl text-foreground">Routines</h1>
                        <p className="mt-1.5 text-muted-foreground">Your workout templates.</p>
                    </div>
                    <Button onClick={openCreateDialog} className="gap-2">
                        <Plus className="h-4 w-4" aria-hidden />
                        New routine
                    </Button>
                </div>
                <div className="relative mx-auto mt-4 max-w-2xl">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        value={searchInput}
                        onChange={handleSearchChange}
                        placeholder="Search routines"
                        aria-label="Search routines"
                        className="h-11 pl-9"
                    />
                </div>
            </div>

            <div className="mx-auto max-w-2xl px-4 pt-6 md:px-8">
                {isLoading ? (
                    <LoadingState label="Loading routines…" />
                ) : hasNoRoutinesAtAll ? (
                    <EmptyState
                        title="Build your first routine"
                        description="Pick the exercises you do together and set targets for each. Starting a workout from a routine is one tap."
                        actionLabel="New routine"
                        onAction={openCreateDialog}
                    />
                ) : hasNoSearchResults ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                        <h3 className="text-lg font-semibold tracking-tight">No routines match "{search}"</h3>
                        <Button
                            variant="ghost"
                            className="mt-4"
                            onClick={() => {
                                setSearchInput('');
                                setSearch('');
                            }}
                        >
                            Clear search
                        </Button>
                    </div>
                ) : (
                    <>
                        <ul className="space-y-2">
                            {routines.map((routine) => (
                                <RoutineRow key={routine.id} routine={routine} workspaceId={workspaceId} />
                            ))}
                        </ul>

                        {hasNextPage && (
                            <div className="mt-4 flex flex-col items-center gap-2">
                                <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                                </Button>
                                <p className="text-xs text-muted-foreground">
                                    Showing {routines.length} of {totalCount}
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New routine</DialogTitle>
                        <DialogDescription>Name it — you'll add exercises next.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="routine-name">Name</Label>
                        <Input
                            id="routine-name"
                            value={name}
                            maxLength={200}
                            placeholder="e.g. Push day"
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && name.trim().length > 0) handleCreate();
                            }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={name.trim().length === 0 || createRoutine.isPending}>
                            {createRoutine.isPending ? 'Creating…' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function RoutineRow({ routine, workspaceId }: { routine: Routine; workspaceId: string }): JSX.Element {
    const count = routine.exerciseCount;

    return (
        <li>
            <Link
                to={`/workspaces/${workspaceId}/routines/${routine.id}`}
                className="flex min-h-[3.5rem] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{routine.name}</span>
                    <span className="block text-xs text-muted-foreground">
                        {count === 1 ? '1 exercise' : `${count} exercises`}
                    </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
        </li>
    );
}
