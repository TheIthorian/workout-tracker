import { useBlocker, useBeforeUnload } from 'react-router-dom';
import { ExerciseImagesEditor } from './ExerciseImagesEditor';
import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    useAddExerciseLink,
    useRemoveExerciseLink,
    useUpdateExercise,
    useUpdateExerciseLink,
} from '@/hooks/use-exercises';
import { toast } from '@/hooks/use-toast';
import type { ExerciseDetail, ExerciseLink } from '@/models/exercise';
import { ExerciseGuide } from './ExerciseGuide';

/**
 * Edits a custom exercise's guide: the four text fields and its links.
 *
 * Two-column at desktop width — the form on the left, a live `ExerciseGuide` preview on the right
 * built from the in-progress form state rather than a refetch, which is only possible because
 * `ExerciseGuide` takes its data as a prop instead of loading it itself.
 *
 * Owns its own "Done editing" control (rather than leaving it to the page that mounts this
 * component) because only this component knows whether there is unsaved guide text or an
 * unfinished link draft — the two things a close must never silently throw away.
 */
export function ExerciseGuideEditor({
    workspaceId,
    exercise,
    onDone,
}: {
    workspaceId: string;
    exercise: ExerciseDetail;
    onDone: () => void;
}): JSX.Element {
    const [setup, setSetup] = useState('');
    const [execution, setExecution] = useState('');
    const [cues, setCues] = useState('');
    const [mistakes, setMistakes] = useState('');

    // Seeded once per exercise, not on every render of `exercise`: a link mutation invalidates the
    // same query and hands back a new object identity, which would otherwise wipe out guide text
    // the user has typed but not yet saved.
    const seededExerciseId = useRef<string | null>(null);

    useEffect(() => {
        if (seededExerciseId.current === exercise.id) return;
        seededExerciseId.current = exercise.id;
        setSetup(exercise.guideSetup ?? '');
        setExecution(exercise.guideExecution ?? '');
        setCues(exercise.guideCues ?? '');
        setMistakes(exercise.guideMistakes ?? '');
    }, [exercise]);

    const updateExercise = useUpdateExercise({ workspaceId });
    const addLink = useAddExerciseLink({ workspaceId, exerciseId: exercise.id });
    const updateLink = useUpdateExerciseLink({ workspaceId, exerciseId: exercise.id });
    const removeLink = useRemoveExerciseLink({ workspaceId, exerciseId: exercise.id });

    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [newLinkLabel, setNewLinkLabel] = useState('');
    const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
    const [editLinkUrl, setEditLinkUrl] = useState('');
    const [editLinkLabel, setEditLinkLabel] = useState('');
    const [imageDirty, setImageDirty] = useState(false);
    const [imageBusy, setImageBusy] = useState(false);
    const [showDiscardDraftConfirm, setShowDiscardDraftConfirm] = useState(false);

    const isGuideDirty =
        setup.trim() !== (exercise.guideSetup ?? '') ||
        execution.trim() !== (exercise.guideExecution ?? '') ||
        cues.trim() !== (exercise.guideCues ?? '') ||
        mistakes.trim() !== (exercise.guideMistakes ?? '');

    // Link mutations save immediately on their own "Add"/"Save" actions, so the only things a close
    // could still silently drop are drafts sitting in these forms that were never submitted: a
    // half-typed new link, or a link mid-edit.
    const hasUnsavedSubFormDraft =
        newLinkUrl.trim().length > 0 || newLinkLabel.trim().length > 0 || editingLinkId !== null || imageDirty;

    const hasUnsavedChanges = isGuideDirty || hasUnsavedSubFormDraft || imageBusy;
    const blocker = useBlocker(hasUnsavedChanges);
    useBeforeUnload((event): void => {
        if (hasUnsavedChanges) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    // What the preview renders: the exercise as it would look if the guide fields were saved right
    // now. Images and links are already live from `exercise` — their mutations invalidate the same
    // query the parent page reads, so no separate preview state is needed for those.
    const previewExercise: ExerciseDetail = {
        ...exercise,
        guideSetup: setup,
        guideExecution: execution,
        guideCues: cues,
        guideMistakes: mistakes,
    };

    const handleSaveGuide = (): void => {
        updateExercise.mutate(
            {
                exerciseId: exercise.id,
                data: {
                    guideSetup: setup.trim() || null,
                    guideExecution: execution.trim() || null,
                    guideCues: cues.trim() || null,
                    guideMistakes: mistakes.trim() || null,
                },
            },
            { onSuccess: () => toast({ title: 'Guide saved' }) },
        );
    };

    /**
     * "Done editing" always saves the guide text before closing — it must, since the button reads
     * as a confirm control, not a discard one. It is blocked by a confirmation first if a link form
     * still holds a draft, since that text can't be auto-saved (it was never confirmed as ready to
     * submit).
     */
    const handleDone = (): void => {
        if (hasUnsavedSubFormDraft) {
            setShowDiscardDraftConfirm(true);
            return;
        }

        finishEditing();
    };

    const finishEditing = (): void => {
        if (!isGuideDirty) {
            onDone();
            return;
        }

        updateExercise.mutate(
            {
                exerciseId: exercise.id,
                data: {
                    guideSetup: setup.trim() || null,
                    guideExecution: execution.trim() || null,
                    guideCues: cues.trim() || null,
                    guideMistakes: mistakes.trim() || null,
                },
            },
            {
                onSuccess: () => {
                    toast({ title: 'Guide saved' });
                    onDone();
                },
            },
        );
    };

    const handleDiscardDraftsAndClose = (): void => {
        setNewLinkUrl('');
        setNewLinkLabel('');
        setEditingLinkId(null);
        setShowDiscardDraftConfirm(false);
        finishEditing();
    };

    const handleAddLink = (): void => {
        const url = newLinkUrl.trim();
        if (!isWebLink(url)) {
            toast({ title: 'Use a full https:// or http:// link', variant: 'destructive' });
            return;
        }

        addLink.mutate(
            { url, label: newLinkLabel.trim() || null },
            {
                onSuccess: () => {
                    setNewLinkUrl('');
                    setNewLinkLabel('');
                    toast({ title: 'Link added' });
                },
            },
        );
    };

    const startEditLink = (link: ExerciseLink): void => {
        setEditingLinkId(link.id);
        setEditLinkUrl(link.url);
        setEditLinkLabel(link.label ?? '');
    };

    const cancelEditLink = (): void => {
        setEditingLinkId(null);
    };

    const handleSaveLink = (): void => {
        const url = editLinkUrl.trim();
        if (!editingLinkId) return;
        if (!isWebLink(url)) {
            toast({ title: 'Use a full https:// or http:// link', variant: 'destructive' });
            return;
        }

        updateLink.mutate(
            { linkId: editingLinkId, data: { url, label: editLinkLabel.trim() || null } },
            {
                onSuccess: () => {
                    setEditingLinkId(null);
                    toast({ title: 'Link saved' });
                },
            },
        );
    };

    const handleRemoveLink = (linkId: string): void => {
        removeLink.mutate(linkId, { onSuccess: () => toast({ title: 'Link removed' }) });
    };

    return (
        <>
            <div className="mb-6 flex items-center justify-between gap-4">
                <h2 className="font-heading text-xl text-foreground">Editing guide</h2>
                <Button
                    variant="secondary"
                    className="gap-2"
                    onClick={handleDone}
                    disabled={updateExercise.isPending || imageBusy}
                >
                    <Check className="h-4 w-4" aria-hidden />
                    {updateExercise.isPending ? 'Saving…' : 'Done editing'}
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <div className="space-y-8">
                    <section className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="guide-setup">Setup</Label>
                            <Textarea
                                id="guide-setup"
                                value={setup}
                                maxLength={4000}
                                placeholder="Bar height, stance, grip — whatever has to be right before the first rep."
                                onChange={(event) => setSetup(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="guide-execution">Execution</Label>
                            <Textarea
                                id="guide-execution"
                                value={execution}
                                maxLength={4000}
                                placeholder="The movement itself, in order."
                                onChange={(event) => setExecution(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="guide-cues">Cues</Label>
                            <Textarea
                                id="guide-cues"
                                value={cues}
                                maxLength={4000}
                                placeholder="The one or two things worth thinking about mid-set."
                                onChange={(event) => setCues(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="guide-mistakes">Common mistakes</Label>
                            <Textarea
                                id="guide-mistakes"
                                value={mistakes}
                                maxLength={4000}
                                placeholder="What tends to go wrong, so it's easy to check for."
                                onChange={(event) => setMistakes(event.target.value)}
                            />
                        </div>
                        <Button onClick={handleSaveGuide} disabled={updateExercise.isPending || imageBusy}>
                            {updateExercise.isPending ? 'Saving…' : 'Save guide'}
                        </Button>
                    </section>

                    <section className="space-y-3 border-t border-border pt-6">
                        <h3 className="font-heading text-lg text-foreground">Links</h3>

                        {exercise.links.length > 0 && (
                            <ul className="space-y-2">
                                {exercise.links.map((link) =>
                                    editingLinkId === link.id ? (
                                        <li
                                            key={link.id}
                                            className="space-y-2 rounded-lg border border-border bg-card p-3"
                                        >
                                            <Input
                                                value={editLinkUrl}
                                                placeholder="https://…"
                                                onChange={(event) => setEditLinkUrl(event.target.value)}
                                                aria-label="Link URL"
                                            />
                                            <Input
                                                value={editLinkLabel}
                                                placeholder="Label (optional)"
                                                onChange={(event) => setEditLinkLabel(event.target.value)}
                                                aria-label="Link label"
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={handleSaveLink}
                                                    disabled={editLinkUrl.trim().length === 0 || updateLink.isPending}
                                                >
                                                    {updateLink.isPending ? 'Saving…' : 'Save'}
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={cancelEditLink}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        </li>
                                    ) : (
                                        <li
                                            key={link.id}
                                            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                                        >
                                            <span className="min-w-0 flex-1 truncate text-sm">
                                                {link.label || link.url}
                                            </span>
                                            <button
                                                type="button"
                                                aria-label="Edit link"
                                                onClick={() => startEditLink(link)}
                                                className="grid h-11 w-11 place-items-center shrink-0 rounded-md text-muted-foreground transition-colors hover:text-foreground"
                                            >
                                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label="Remove link"
                                                onClick={() => handleRemoveLink(link.id)}
                                                disabled={removeLink.isPending && removeLink.variables === link.id}
                                                className="grid h-11 w-11 place-items-center shrink-0 rounded-md text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                            </button>
                                        </li>
                                    ),
                                )}
                            </ul>
                        )}

                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                value={newLinkUrl}
                                placeholder="https://…"
                                onChange={(event) => setNewLinkUrl(event.target.value)}
                                aria-label="New link URL"
                            />
                            <Input
                                value={newLinkLabel}
                                placeholder="Label (optional)"
                                onChange={(event) => setNewLinkLabel(event.target.value)}
                                aria-label="New link label"
                                className="sm:max-w-[10rem]"
                            />
                            <Button
                                className="shrink-0 gap-1.5"
                                onClick={handleAddLink}
                                disabled={newLinkUrl.trim().length === 0 || addLink.isPending}
                            >
                                <Plus className="h-4 w-4" aria-hidden />
                                Add
                            </Button>
                        </div>
                    </section>
                    <ExerciseImagesEditor
                        workspaceId={workspaceId}
                        exerciseId={exercise.id}
                        images={exercise.images}
                        onDirtyChange={setImageDirty}
                        onBusyChange={setImageBusy}
                    />
                </div>

                <div className="lg:sticky lg:top-24 lg:self-start">
                    <p className="mb-2 text-xs text-muted-foreground">This is how the guide will look once saved.</p>
                    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-4">
                        <ExerciseGuide exercise={previewExercise} />
                    </div>
                </div>
            </div>

            <AlertDialog open={showDiscardDraftConfirm} onOpenChange={setShowDiscardDraftConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Finish your unsaved attachments?</AlertDialogTitle>
                        <AlertDialogDescription>
                            An image or link still has unsaved changes. Finish it before leaving, or discard the draft.
                            Your guide text will be saved.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep editing</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDiscardDraftsAndClose}>Discard and close</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
                open={blocker.state === 'blocked'}
                onOpenChange={(open) => {
                    if (!open && blocker.state === 'blocked') blocker.reset();
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Keep your changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes to this exercise. Stay here to save them, or leave and discard the
                            draft.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            onClick={() => {
                                if (blocker.state === 'blocked') blocker.reset();
                            }}
                        >
                            Keep editing
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={imageBusy || updateExercise.isPending}
                            onClick={() => {
                                if (blocker.state === 'blocked') blocker.proceed();
                            }}
                        >
                            Discard and leave
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function isWebLink(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}
