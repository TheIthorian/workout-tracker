import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pencil, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { httpClient } from '@/lib/http-client';
import { toast } from '@/hooks/use-toast';
import type { ExerciseGuideImage } from '@/models/exercise';

/** Uploads reference images and saves captions independently of the guide’s text draft. */
export function ExerciseImagesEditor({
    workspaceId,
    exerciseId,
    images,
    onDirtyChange,
    onBusyChange,
}: {
    workspaceId: string;
    exerciseId: string;
    images: ExerciseGuideImage[];
    onDirtyChange: (dirty: boolean) => void;
    onBusyChange: (busy: boolean) => void;
}): JSX.Element {
    const queryClient = useQueryClient();
    const base = `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images`;
    const [file, setFile] = useState<File | null>(null);
    const [caption, setCaption] = useState('');
    const [inputKey, setInputKey] = useState(0);
    const [editing, setEditing] = useState<ExerciseGuideImage | null>(null);
    const [editCaption, setEditCaption] = useState('');
    const [removing, setRemoving] = useState<ExerciseGuideImage | null>(null);
    const refresh = async (): Promise<void> => {
        await queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
    };
    const upload = useMutation({
        mutationFn: async (): Promise<ExerciseGuideImage> => {
            const body = new FormData();
            body.append('file', file!);
            return httpClient.postFormData<ExerciseGuideImage>(
                `${base}?${new URLSearchParams({ caption: caption.trim() })}`,
                body,
            );
        },
        onSuccess: async () => {
            setFile(null);
            setCaption('');
            setInputKey((key) => key + 1);
            await refresh();
            toast({ title: 'Reference image added' });
        },
    });
    const update = useMutation({
        mutationFn: (): Promise<ExerciseGuideImage> =>
            httpClient.patch(`${base}/${editing!.id}`, { caption: editCaption.trim() || null }),
        onSuccess: async () => {
            setEditing(null);
            await refresh();
            toast({ title: 'Caption saved' });
        },
    });
    const remove = useMutation({
        mutationFn: (): Promise<void> => httpClient.delete(`${base}/${removing!.id}`),
        onSuccess: async () => {
            setRemoving(null);
            await refresh();
            toast({ title: 'Image removed' });
        },
    });
    const dirty = file !== null || caption.trim().length > 0 || editing !== null;
    const busy = upload.isPending || update.isPending || remove.isPending;
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
        onBusyChange(busy);
    }, [busy, onBusyChange]);
    return (
        <section className="space-y-4 border-t pt-6">
            <div>
                <h3 className="text-lg">Reference images</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    JPG, PNG, or WebP, up to 10 MB. Images save separately.
                </p>
            </div>
            {images.length > 0 && (
                <ul className="space-y-3">
                    {images.map((image) => (
                        <li key={image.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                            <img
                                src={image.url}
                                alt={image.caption || 'Exercise reference'}
                                className="h-16 w-16 rounded-lg object-cover"
                            />
                            <div className="min-w-0 flex-1">
                                {editing?.id === image.id ? (
                                    <div className="space-y-2">
                                        <Input
                                            aria-label="Edit image caption"
                                            value={editCaption}
                                            maxLength={200}
                                            onChange={(event) => setEditCaption(event.target.value)}
                                        />
                                        <div className="flex gap-2">
                                            <Button size="sm" disabled={busy} onClick={() => update.mutate()}>
                                                Save caption
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="break-words text-sm text-muted-foreground">
                                        {image.caption || 'No caption'}
                                    </p>
                                )}
                            </div>
                            {editing?.id !== image.id && (
                                <div className="flex flex-col sm:flex-row">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Edit image caption"
                                        disabled={busy || editing !== null}
                                        onClick={() => {
                                            setEditing(image);
                                            setEditCaption(image.caption || '');
                                        }}
                                    >
                                        <Pencil />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Remove image"
                                        disabled={busy}
                                        onClick={() => setRemoving(image)}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <div className="space-y-3 rounded-xl border border-dashed bg-card p-4">
                <Label htmlFor="reference-file" className="flex items-center gap-2">
                    <ImagePlus className="h-4 w-4 text-primary" />
                    Add a reference
                </Label>
                <Input
                    key={inputKey}
                    id="reference-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    className="h-auto min-h-12 py-3 text-xs file:mr-2"
                    onChange={(event) => {
                        const selected = event.target.files?.[0];
                        if (!selected) {
                            setFile(null);
                            return;
                        }
                        if (
                            !['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) ||
                            selected.size > 10 * 1024 * 1024
                        ) {
                            toast({ title: 'Choose a JPG, PNG, or WebP under 10 MB', variant: 'destructive' });
                            setFile(null);
                            setInputKey((key) => key + 1);
                            return;
                        }
                        setFile(selected);
                    }}
                />
                <Input
                    aria-label="New image caption"
                    value={caption}
                    maxLength={200}
                    placeholder="Caption (optional)"
                    disabled={busy}
                    onChange={(event) => setCaption(event.target.value)}
                />
                <Button variant="outline" disabled={!file || busy} onClick={() => upload.mutate()}>
                    <Upload />
                    {upload.isPending ? 'Uploading…' : 'Upload image'}
                </Button>
            </div>
            <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove this reference image?</DialogTitle>
                        <DialogDescription>You can upload it again later if you change your mind.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRemoving(null)}>
                            Keep image
                        </Button>
                        <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                            {remove.isPending ? 'Removing…' : 'Remove image'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
