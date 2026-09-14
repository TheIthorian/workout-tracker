import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

/** Switches workspaces while preserving the current primary destination. */
export function WorkspaceSwitcher({
    className,
    triggerClassName,
}: {
    className?: string;
    triggerClassName?: string;
}): JSX.Element | null {
    const { currentWorkspace, workspaces } = useWorkspace();
    const navigate = useNavigate();
    const location = useLocation();
    if (!currentWorkspace) return null;
    return (
        <div className={cn('min-w-0', className)}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        aria-label={`Switch workspace: ${currentWorkspace.name}`}
                        className={cn('max-w-[48vw] gap-2 px-2 text-xs md:max-w-48 md:text-sm', triggerClassName)}
                    >
                        <Users className="hidden text-muted-foreground sm:block" aria-hidden />
                        <span className="truncate">{currentWorkspace.name}</span>
                        <ChevronDown className="h-3 w-3" aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="eyebrow py-3">Your workspaces</DropdownMenuLabel>
                    {workspaces.map((workspace) => (
                        <DropdownMenuItem
                            key={workspace.workspaceId}
                            className="min-h-12 gap-2"
                            onSelect={() => {
                                const section = location.pathname.split('/')[3] || 'today';
                                navigate(`/workspaces/${workspace.workspaceId}/${section}`);
                            }}
                        >
                            <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="flex-1 truncate">{workspace.name}</span>
                            {workspace.workspaceId === currentWorkspace.workspaceId && (
                                <Check className="h-4 w-4 text-primary" aria-hidden />
                            )}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="min-h-12 gap-2"
                        onSelect={() => navigate(`/workspaces/${currentWorkspace.workspaceId}/settings?tab=workspaces`)}
                    >
                        <Plus className="h-4 w-4" aria-hidden />
                        Manage workspaces
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
