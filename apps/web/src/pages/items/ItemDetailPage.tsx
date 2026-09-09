import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { LoadingState } from '@/components/common/LoadingState';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { itemsApi } from '@/lib/api';
import NotFoundError from '@/pages/NotFoundError';

/** The example detail/edit page: load one item, edit it in place, or delete it. */
export default function ItemDetailPage(): JSX.Element {
    const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isDeleteOpen, setDeleteOpen] = useState(false);

    const { data: item, isLoading, isError } = useQuery({
        queryKey: ['items', workspaceId, itemId],
        queryFn: () => itemsApi.getById(workspaceId, itemId),
        enabled: Boolean(workspaceId && itemId),
    });

    // Seed the form once the item arrives; the query is the source of truth until then.
    useEffect(() => {
        if (!item) return;
        setName(item.name);
        setDescription(item.description ?? '');
    }, [item]);

    const saveItem = useMutation({
        mutationFn: () =>
            itemsApi.update(workspaceId, itemId, { name: name.trim(), description: description.trim() || null }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['items', workspaceId] });
            toast({ title: 'Item saved' });
        },
    });

    const deleteItem = useMutation({
        mutationFn: () => itemsApi.remove(workspaceId, itemId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['items', workspaceId] });
            toast({ title: 'Item deleted' });
            navigate(`/workspaces/${workspaceId}/`);
        },
    });

    if (isLoading) {
        return (
            <div className='mx-auto max-w-3xl px-4 py-10'>
                <LoadingState label='Loading item…' />
            </div>
        );
    }

    if (isError || !item) {
        return <NotFoundError />;
    }

    return (
        <div className='mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10'>
            <Button variant='ghost' className='mb-6 gap-2' onClick={() => navigate(`/workspaces/${workspaceId}/`)}>
                <ArrowLeft className='h-4 w-4' aria-hidden />
                Back to items
            </Button>

            <Card className='overflow-hidden border-border/80 shadow-sm'>
                <CardHeader className='border-b border-border/60 bg-muted/20'>
                    <CardTitle className='text-lg'>Edit item</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4 pt-6'>
                    <div className='space-y-2'>
                        <Label htmlFor='item-name'>Name</Label>
                        <Input
                            id='item-name'
                            value={name}
                            maxLength={200}
                            onChange={event => setName(event.target.value)}
                        />
                    </div>
                    <div className='space-y-2'>
                        <Label htmlFor='item-description'>Description</Label>
                        <Textarea
                            id='item-description'
                            value={description}
                            maxLength={2000}
                            onChange={event => setDescription(event.target.value)}
                        />
                    </div>
                    <div className='flex flex-wrap items-center gap-3'>
                        <Button onClick={() => saveItem.mutate()} disabled={name.trim().length === 0 || saveItem.isPending}>
                            {saveItem.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button variant='destructive' className='gap-2' onClick={() => setDeleteOpen(true)}>
                            <Trash2 className='h-4 w-4' aria-hidden />
                            Delete
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={isDeleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                            onClick={() => deleteItem.mutate()}
                            disabled={deleteItem.isPending}
                        >
                            {deleteItem.isPending ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
