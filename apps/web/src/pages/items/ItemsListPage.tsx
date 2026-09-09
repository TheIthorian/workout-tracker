import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { itemsApi } from '@/lib/api';

/**
 * The example list page. It is deliberately plain — a paginated list, a create dialog, and links
 * into the detail page — so the shape is easy to copy for a real resource.
 */
export default function ItemsListPage(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [isCreateOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['items', workspaceId],
        queryFn: () => itemsApi.getAll(workspaceId),
        enabled: Boolean(workspaceId),
    });

    const createItem = useMutation({
        mutationFn: () => itemsApi.create(workspaceId, { name: name.trim(), description: description.trim() || null }),
        onSuccess: created => {
            queryClient.invalidateQueries({ queryKey: ['items', workspaceId] });
            toast({ title: 'Item created' });
            setCreateOpen(false);
            setName('');
            setDescription('');
            navigate(`/workspaces/${workspaceId}/items/${created.id}`);
        },
    });

    const items = data?.data ?? [];

    return (
        <div className='mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10'>
            <div className='mb-8 flex flex-wrap items-start justify-between gap-4'>
                <div>
                    <h1 className='font-heading text-3xl text-foreground md:text-4xl'>Items</h1>
                    <p className='mt-1.5 text-muted-foreground'>Everything in this workspace.</p>
                </div>
                <Button onClick={() => setCreateOpen(true)} className='gap-2'>
                    <Plus className='h-4 w-4' aria-hidden />
                    New item
                </Button>
            </div>

            {isLoading ? (
                <LoadingState label='Loading items…' />
            ) : items.length === 0 ? (
                <EmptyState
                    title='No items yet'
                    description='Create your first item to see it here.'
                    actionLabel='New item'
                    onAction={() => setCreateOpen(true)}
                />
            ) : (
                <ul className='grid gap-4 sm:grid-cols-2'>
                    {items.map(item => (
                        <li key={item.id}>
                            <Card
                                role='link'
                                tabIndex={0}
                                onClick={() => navigate(`/workspaces/${workspaceId}/items/${item.id}`)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        navigate(`/workspaces/${workspaceId}/items/${item.id}`);
                                    }
                                }}
                                className='cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                            >
                                <CardHeader>
                                    <CardTitle className='truncate text-lg'>{item.name}</CardTitle>
                                    {item.description && (
                                        <CardDescription className='line-clamp-2'>{item.description}</CardDescription>
                                    )}
                                </CardHeader>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}

            {data && data.totalPages > 1 && (
                <p className='mt-6 text-sm text-muted-foreground'>
                    Showing page {data.page} of {data.totalPages} · {data.totalCount} items
                </p>
            )}

            <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New item</DialogTitle>
                        <DialogDescription>Items belong to the workspace, not to you personally.</DialogDescription>
                    </DialogHeader>
                    <div className='space-y-4'>
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
                            <Label htmlFor='item-description'>Description (optional)</Label>
                            <Textarea
                                id='item-description'
                                value={description}
                                maxLength={2000}
                                onChange={event => setDescription(event.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant='ghost' onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => createItem.mutate()}
                            disabled={name.trim().length === 0 || createItem.isPending}
                        >
                            {createItem.isPending ? 'Creating…' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
