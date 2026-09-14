import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { workspacesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { WorkspaceRole, type MemberListItem, type WorkspaceListItem } from '@/models/workspace';

/** Workspace and member management, with controls matched to the caller’s role. */
export function WorkspaceSettings(): JSX.Element {
    const { user, refreshUser } = useAuth();
    const { currentWorkspace } = useWorkspace();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const {
        data: workspaces = [],
        isLoading,
        isError,
        refetch,
    } = useQuery({ queryKey: ['workspaces'], queryFn: () => workspacesApi.getAll() });
    const {
        data: active,
        isLoading: membersLoading,
        isError: membersError,
        refetch: refetchMembers,
    } = useQuery({
        queryKey: ['workspaces', currentWorkspace?.workspaceId],
        queryFn: () => workspacesApi.getById(currentWorkspace!.workspaceId),
        enabled: Boolean(currentWorkspace),
    });
    const canManage = active?.role === WorkspaceRole.Admin || active?.role === WorkspaceRole.Owner;
    const isOwner = active?.role === WorkspaceRole.Owner;
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<WorkspaceListItem | null>(null);
    const [name, setName] = useState('');
    const [deleting, setDeleting] = useState<WorkspaceListItem | null>(null);
    const [confirmation, setConfirmation] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState(WorkspaceRole.Member);
    const [removing, setRemoving] = useState<MemberListItem | null>(null);
    const refresh = async (): Promise<void> => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['workspaces'] }), refreshUser()]);
    };
    const create = useMutation({
        mutationFn: () => workspacesApi.create({ name: name.trim() }),
        onSuccess: async (workspace) => {
            await refresh();
            setCreateOpen(false);
            toast({ title: 'Your workspace is ready' });
            navigate(`/workspaces/${workspace.workspaceId}/settings?tab=workspaces`);
        },
    });
    const rename = useMutation({
        mutationFn: () => workspacesApi.update(editing!.workspaceId, { name: name.trim() }),
        onSuccess: async () => {
            await refresh();
            setEditing(null);
            toast({ title: 'Workspace renamed' });
        },
    });
    const remove = useMutation({
        mutationFn: (workspaceId: string) => workspacesApi.remove(workspaceId),
        onSuccess: async (_data, removedId) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['workspaces'], exact: true }),
                refreshUser(),
            ]);
            setDeleting(null);
            toast({ title: 'Workspace deleted' });
            if (removedId === currentWorkspace?.workspaceId) {
                const next = workspaces.find((workspace) => workspace.workspaceId !== removedId);
                navigate(
                    next ? `/workspaces/${next.workspaceId}/settings?tab=workspaces` : '/settings?tab=workspaces',
                    { replace: true },
                );
            }
        },
    });
    const invite = useMutation({
        mutationFn: () => workspacesApi.addMember(active!.workspaceId, { email: email.trim(), role }),
        onSuccess: async () => {
            await refresh();
            setInviteOpen(false);
            toast({ title: 'Member added to your workspace' });
        },
    });
    const changeRole = useMutation({
        mutationFn: ({ userId, role: nextRole }: { userId: string; role: WorkspaceRole }) =>
            workspacesApi.updateMemberRole(active!.workspaceId, userId, nextRole),
        onSuccess: async () => {
            await refresh();
            toast({ title: 'Member role updated' });
        },
    });
    const removeMember = useMutation({
        mutationFn: () => workspacesApi.removeMember(active!.workspaceId, removing!.userId),
        onSuccess: async () => {
            await refresh();
            setRemoving(null);
            toast({ title: 'Member removed' });
        },
    });
    if (isLoading) return <LoadingState label="Loading your shared spaces…" />;
    if (isError)
        return (
            <EmptyState
                title="Workspaces couldn’t load"
                description="Check your connection and try again."
                actionLabel="Try again"
                onAction={() => void refetch()}
            />
        );
    return (
        <div className="space-y-6">
            <Card className="shadow-none">
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl">Your shared spaces</CardTitle>
                            <CardDescription className="mt-2">
                                Train on your own, or keep a library with your people.
                            </CardDescription>
                        </div>
                        <Button
                            onClick={() => {
                                setName('');
                                setCreateOpen(true);
                            }}
                        >
                            <Plus aria-hidden />
                            New workspace
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <ul className="divide-y">
                        {workspaces.map((workspace) => (
                            <li key={workspace.workspaceId} className="flex items-center gap-3 py-4">
                                <span className="exercise-icon h-10 w-10">
                                    <Users className="h-4 w-4" aria-hidden />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-semibold">{workspace.name}</p>
                                    <p className="mt-1 text-xs capitalize text-muted-foreground">{workspace.role}</p>
                                </div>
                                {workspace.workspaceId === active?.workspaceId ? (
                                    <Check className="h-4 w-4 text-primary" aria-label="Current workspace" />
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            navigate(`/workspaces/${workspace.workspaceId}/settings?tab=workspaces`)
                                        }
                                    >
                                        Switch
                                    </Button>
                                )}
                                {workspace.role !== WorkspaceRole.Member && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Edit ${workspace.name}`}
                                        onClick={() => {
                                            setName(workspace.name);
                                            setEditing(workspace);
                                        }}
                                    >
                                        <Pencil />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {!workspaces.length && (
                        <p className="py-4 text-sm text-muted-foreground">
                            Create your first workspace to start building your exercise library.
                        </p>
                    )}
                </CardContent>
            </Card>
            {membersLoading && currentWorkspace && <LoadingState label="Loading members…" />}
            {membersError && (
                <EmptyState
                    title="Members couldn’t load"
                    description="Try again to see who has access."
                    actionLabel="Try again"
                    onAction={() => void refetchMembers()}
                />
            )}
            {active && (
                <Card className="shadow-none">
                    <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-xl">Training is better together</CardTitle>
                                <CardDescription className="mt-2">Members of {active.name}</CardDescription>
                            </div>
                            {canManage && (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setEmail('');
                                        setRole(WorkspaceRole.Member);
                                        setInviteOpen(true);
                                    }}
                                >
                                    <UserPlus />
                                    Invite member
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ul className="divide-y">
                            {active.members.map((member) => {
                                const editable =
                                    canManage &&
                                    member.userId !== user?.userId &&
                                    (isOwner || member.role === WorkspaceRole.Member);
                                return (
                                    <li key={member.userId} className="flex flex-wrap items-center gap-3 py-4">
                                        <div className="min-w-[120px] flex-1">
                                            <p className="break-words text-sm font-medium">
                                                {member.displayName || member.email}
                                                {member.userId === user?.userId && (
                                                    <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                                                )}
                                            </p>
                                            <p className="mt-1 break-all text-xs text-muted-foreground">
                                                {member.email}
                                            </p>
                                        </div>
                                        {editable ? (
                                            <Select
                                                value={member.role}
                                                disabled={changeRole.isPending}
                                                onValueChange={(value) => {
                                                    const next = Object.values(WorkspaceRole).find(
                                                        (item) => item === value,
                                                    );
                                                    if (next) changeRole.mutate({ userId: member.userId, role: next });
                                                }}
                                            >
                                                <SelectTrigger
                                                    className="w-28 capitalize"
                                                    aria-label={`Role for ${member.displayName || member.email}`}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={WorkspaceRole.Member}>Member</SelectItem>
                                                    <SelectItem value={WorkspaceRole.Admin}>Admin</SelectItem>
                                                    {isOwner && (
                                                        <SelectItem value={WorkspaceRole.Owner}>Owner</SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Badge variant="secondary" className="capitalize">
                                                {member.role}
                                            </Badge>
                                        )}
                                        {editable && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`Remove ${member.displayName || member.email}`}
                                                onClick={() => setRemoving(member)}
                                            >
                                                <Trash2 className="text-muted-foreground" />
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        {!canManage && (
                            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                                An owner or admin can invite people and manage access.
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}
            <Dialog
                open={createOpen || editing !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setCreateOpen(false);
                        setEditing(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing ? 'Edit workspace' : 'A new space to train'}</DialogTitle>
                        <DialogDescription>
                            {editing
                                ? 'Give your shared space a name that feels like yours.'
                                : 'Your exercises and routines will have a home here.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (name.trim()) {
                                if (editing) rename.mutate();
                                else create.mutate();
                            }
                        }}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="workspace-name">Workspace name</Label>
                            <Input
                                id="workspace-name"
                                value={name}
                                maxLength={200}
                                required
                                onChange={(event) => setName(event.target.value)}
                                placeholder="e.g. The garage gym"
                            />
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={!name.trim() || create.isPending || rename.isPending}>
                                {create.isPending || rename.isPending
                                    ? 'Saving…'
                                    : editing
                                      ? 'Save name'
                                      : 'Create workspace'}
                            </Button>
                        </DialogFooter>
                    </form>
                    {editing?.role === WorkspaceRole.Owner && (
                        <div className="mt-3 border-t pt-5">
                            <Button
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => {
                                    setDeleting(editing);
                                    setEditing(null);
                                    setConfirmation('');
                                }}
                            >
                                <Trash2 />
                                Delete workspace
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete {deleting?.name}?</DialogTitle>
                        <DialogDescription>
                            This permanently removes its exercises, routines, and workout history for everyone. This
                            cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <Label htmlFor="delete-workspace">Type “{deleting?.name}” to confirm</Label>
                    <Input
                        id="delete-workspace"
                        autoComplete="off"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleting(null)}>
                            Keep workspace
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={confirmation !== deleting?.name || remove.isPending}
                            onClick={() => {
                                if (deleting) remove.mutate(deleting.workspaceId);
                            }}
                        >
                            {remove.isPending ? 'Deleting…' : 'Delete permanently'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bring your people</DialogTitle>
                        <DialogDescription>
                            Add someone by the email they use for Forma. They’ll need an account first; access is
                            available immediately.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            invite.mutate();
                        }}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="invite-email">Email address</Label>
                            <Input
                                id="invite-email"
                                type="email"
                                required
                                value={email}
                                autoComplete="email"
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="friend@example.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-role">Their role</Label>
                            <Select
                                value={role}
                                onValueChange={(value) => {
                                    const next = Object.values(WorkspaceRole).find((item) => item === value);
                                    if (next) setRole(next);
                                }}
                            >
                                <SelectTrigger id="invite-role">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={WorkspaceRole.Member}>
                                        Member — train and edit exercises
                                    </SelectItem>
                                    <SelectItem value={WorkspaceRole.Admin}>Admin — also manage members</SelectItem>
                                    {isOwner && (
                                        <SelectItem value={WorkspaceRole.Owner}>
                                            Owner — full control, including deletion
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={!email.trim() || invite.isPending}>
                                {invite.isPending ? 'Adding…' : 'Add to workspace'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove {removing?.displayName || removing?.email}?</DialogTitle>
                        <DialogDescription>
                            They’ll lose access to {active?.name}. Their past workouts will stay in the workspace.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRemoving(null)}>
                            Keep member
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={removeMember.isPending}
                            onClick={() => removeMember.mutate()}
                        >
                            {removeMember.isPending ? 'Removing…' : 'Remove member'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
