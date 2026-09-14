import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Check, ChevronRight, Dumbbell, Plus, Search, X } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { useCreateExercise, useExercises } from '@/hooks/use-exercises';
import { toast } from '@/hooks/use-toast';
import { TRACKING_TYPE_META, TrackingType, type Exercise } from '@/models/exercise';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/** A paginated library with a quick search and visible, accessible creation controls. */
export default function ExercisesListPage(): JSX.Element {
    const { workspaceId } = useWorkspace();
    const navigate = useNavigate();
    const [isCreateOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [trackingType, setTrackingType] = useState(TrackingType.WeightReps);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [includeArchived, setIncludeArchived] = useState(false);
    useEffect(() => {
        const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 180);
        return () => window.clearTimeout(timeout);
    }, [searchInput]);
    const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useExercises({
        workspaceId,
        search,
        includeArchived,
    });
    const createExercise = useCreateExercise({ workspaceId });
    const exercises = data?.pages.flatMap((page) => page.data) ?? [];
    const totalCount = data?.pages[0]?.totalCount ?? 0;
    const clearSearch = (): void => {
        setSearchInput('');
        setSearch('');
    };
    const openCreate = (): void => {
        setName('');
        setTrackingType(TrackingType.WeightReps);
        setCreateOpen(true);
    };
    const handleCreate = (event: React.FormEvent): void => {
        event.preventDefault();
        if (!name.trim() || createExercise.isPending) return;
        createExercise.mutate(
            { name: name.trim(), trackingType },
            {
                onSuccess: (created) => {
                    toast({ title: 'Exercise added. Make it yours.' });
                    setCreateOpen(false);
                    navigate(`/exercises/${created.id}`);
                },
            },
        );
    };
    return (
        <div className="page-shell">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
                <div>
                    <p className="eyebrow mb-3">Your training toolkit</p>
                    <h1 className="page-title">
                        Exercise library<span className="text-primary">.</span>
                    </h1>
                    <p className="mt-3 text-muted-foreground">Find your movement. Make every rep count.</p>
                </div>
                <Button onClick={openCreate} className="gap-2 rounded-xl px-5">
                    <Plus aria-hidden />
                    New exercise
                </Button>
            </div>
            <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
                <section aria-label="Exercise library" className="min-w-0">
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-muted-foreground"
                            aria-hidden
                        />
                        <Input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            placeholder="Search your exercises…"
                            aria-label="Search exercises"
                            className="h-14 rounded-xl border-border bg-card pl-12 pr-14 shadow-sm"
                        />
                        {searchInput && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={clearSearch}
                                aria-label="Clear search"
                                className="absolute right-1 top-1"
                            >
                                <X />
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 py-5">
                        <h2 className="text-sm font-semibold tracking-normal">
                            {search ? 'Search results' : 'All exercises'}
                            {!isLoading && !isError && (
                                <span className="ml-2 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">
                                    {totalCount}
                                </span>
                            )}
                        </h2>
                        <div className="flex items-center gap-2">
                            <Switch
                                id="include-archived"
                                checked={includeArchived}
                                onCheckedChange={setIncludeArchived}
                            />
                            <Label
                                htmlFor="include-archived"
                                className="cursor-pointer py-2 text-xs text-muted-foreground"
                            >
                                Include archived
                            </Label>
                        </div>
                    </div>
                    {isLoading ? (
                        <LoadingState label="Finding your exercises…" />
                    ) : isError ? (
                        <EmptyState
                            title="Your library couldn’t load"
                            description="Check your connection and try again. Your exercises are still safe."
                            actionLabel="Try again"
                            onAction={() => void refetch()}
                        />
                    ) : exercises.length === 0 ? (
                        <EmptyState
                            title={search ? 'No matching movements' : 'Your next workout starts here'}
                            description={
                                search
                                    ? `Nothing matches “${search}”. Try another name or clear your search.`
                                    : 'Add an exercise you love. Choose how to track it, then keep your technique notes close at hand.'
                            }
                            actionLabel={search ? 'Clear search' : 'Add your first exercise'}
                            onAction={search ? clearSearch : openCreate}
                        />
                    ) : (
                        <>
                            <ul className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                                {exercises.map((exercise) => (
                                    <ExerciseRow key={exercise.id} exercise={exercise} />
                                ))}
                            </ul>
                            <div className="mt-5 flex items-center justify-between gap-3">
                                <p className="text-xs text-muted-foreground" role="status">
                                    Showing {exercises.length} of {totalCount} exercises
                                </p>
                                {hasNextPage && (
                                    <Button
                                        variant="outline"
                                        onClick={() => void fetchNextPage()}
                                        disabled={isFetchingNextPage}
                                    >
                                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </section>
                <aside className="space-y-5 lg:pt-0">
                    <div className="training-banner p-6">
                        <div className="training-rings opacity-60" aria-hidden />
                        <div className="relative">
                            <BookOpen className="mb-9 h-6 w-6 text-[#c8dfac]" aria-hidden />
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-[#c8dfac]">
                                A little guidance
                            </p>
                            <h2 className="text-2xl leading-tight">
                                Good form.
                                <br />
                                Better sessions.
                            </h2>
                            <p className="mt-3 text-sm leading-relaxed text-[#d0dfd5]">
                                Open any exercise for setup notes, helpful cues, and a quick refresher between sets.
                            </p>
                            <div className="mt-6 border-t border-white/15 pt-4 text-xs text-[#d0dfd5]">
                                A little intention goes a long way.
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border p-5">
                        <h2 className="mb-4 text-sm font-semibold tracking-normal">A way to track every movement</h2>
                        <div className="space-y-4">
                            {Object.values(TrackingType).map((type) => {
                                const { icon: Icon, label } = TRACKING_TYPE_META[type];
                                return (
                                    <div key={type} className="flex items-center gap-3">
                                        <span data-type={type} className="exercise-icon h-9 w-9 rounded-lg">
                                            <Icon className="h-4 w-4" aria-hidden />
                                        </span>
                                        <span className="text-xs text-muted-foreground">{label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <Link
                        to="/routines"
                        className="flex min-h-12 items-center justify-between px-1 text-sm font-medium text-primary"
                    >
                        Put your movements into a routine
                        <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
                    </Link>
                </aside>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <span className="exercise-icon mb-2">
                            <Dumbbell aria-hidden />
                        </span>
                        <DialogTitle className="text-2xl">Add a movement</DialogTitle>
                        <DialogDescription>
                            A familiar name and a way to measure it. That’s all you need.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="exercise-name">Exercise name</Label>
                            <Input
                                id="exercise-name"
                                value={name}
                                maxLength={200}
                                required
                                placeholder="e.g. Barbell back squat"
                                onChange={(event) => setName(event.target.value)}
                            />
                        </div>
                        <fieldset>
                            <legend className="mb-3 text-sm font-medium">How will you track it?</legend>
                            <div className="space-y-2">
                                {Object.values(TrackingType).map((type) => {
                                    const { icon: Icon, label } = TRACKING_TYPE_META[type];
                                    return (
                                        <label
                                            key={type}
                                            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${trackingType === type ? 'border-primary bg-primary/5' : 'hover:bg-secondary'}`}
                                        >
                                            <input
                                                className="sr-only peer"
                                                type="radio"
                                                name="tracking-type"
                                                value={type}
                                                checked={trackingType === type}
                                                onChange={() => setTrackingType(type)}
                                            />
                                            <span
                                                className="exercise-icon h-10 w-10 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                                                data-type={type}
                                            >
                                                <Icon className="h-5 w-5" aria-hidden />
                                            </span>
                                            <span className="flex-1 text-sm font-medium">{label}</span>
                                            {trackingType === type && (
                                                <Check className="h-5 w-5 text-primary" aria-hidden />
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </fieldset>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={!name.trim() || createExercise.isPending}>
                                {createExercise.isPending ? 'Adding…' : 'Add exercise'}
                                <Plus aria-hidden />
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ExerciseRow({ exercise }: { exercise: Exercise }): JSX.Element {
    const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];
    return (
        <li className="border-b last:border-0">
            <Link
                to={`/exercises/${exercise.id}`}
                className="group flex min-h-[90px] items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
            >
                <span className="exercise-icon" data-type={exercise.trackingType}>
                    <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block break-words text-[15px] font-semibold leading-snug">{exercise.name}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {label}
                        {exercise.isCatalog && (
                            <>
                                <span aria-hidden>·</span>
                                <span>Forma guide</span>
                            </>
                        )}
                        {exercise.archivedAt && <span className="rounded bg-secondary px-1.5 py-0.5">Archived</span>}
                    </span>
                </span>
                <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1"
                    aria-hidden
                />
            </Link>
        </li>
    );
}
