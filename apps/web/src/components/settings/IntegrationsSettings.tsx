import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { formatDate } from '@/lib/date-format';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mcpAccessTokensApi } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { analyticsEvents, useAnalytics, withWorkspaceProperties } from '@/lib/analytics';
import type { McpAccessTokenCreated, McpAccessTokenListItem } from '@/models/mcp';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function formatTokenTimestamp(iso: string): string {
    try {
        return formatDate(iso);
    } catch {
        return iso;
    }
}

export function IntegrationsSettings(): JSX.Element {
    const queryClient = useQueryClient();
    const { currentWorkspace, workspaceId } = useWorkspace();
    const { capture } = useAnalytics();
    const isMobile = useIsMobile();

    const [optionalLabel, setOptionalLabel] = useState('');
    const [createdConnection, setCreatedConnection] = useState<McpAccessTokenCreated | null>(null);
    const [urlCopied, setUrlCopied] = useState(false);
    const [tokenToRevoke, setTokenToRevoke] = useState<McpAccessTokenListItem | null>(null);

    const { data: tokens = [], isLoading: tokensLoading } = useQuery({
        queryKey: ['mcp-access-tokens'],
        queryFn: () => mcpAccessTokensApi.list(),
    });

    const createToken = useMutation({
        mutationFn: () => {
            const trimmed = optionalLabel.trim();
            return mcpAccessTokensApi.create({
                workspaceId,
                ...(trimmed ? { name: trimmed } : {}),
            });
        },
        onSuccess: (data) => {
            capture(analyticsEvents.mcpAccessTokenCreated, withWorkspaceProperties(currentWorkspace));
            queryClient.invalidateQueries({ queryKey: ['mcp-access-tokens'] });
            setCreatedConnection(data);
            setUrlCopied(false);
            setOptionalLabel('');
        },
    });

    const revokeToken = useMutation({
        mutationFn: (tokenId: string) => mcpAccessTokensApi.revoke(tokenId),
        onSuccess: (_data, tokenId) => {
            capture(analyticsEvents.mcpAccessTokenRevoked, withWorkspaceProperties(currentWorkspace));
            queryClient.invalidateQueries({ queryKey: ['mcp-access-tokens'] });
            toast({ title: 'Connection revoked' });
            setTokenToRevoke(null);
        },
    });

    async function copyMcpUrl(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            setUrlCopied(true);
            toast({ title: 'Copied to clipboard' });
        } catch {
            toast({
                title: 'Copy failed',
                description: 'Select the URL and copy it manually.',
                variant: 'destructive',
            });
        }
    }

    const sortedTokens = useMemo(
        () => [...tokens].sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime()),
        [tokens],
    );

    return (
        <>
            <div className="space-y-6">
                <Card className="overflow-hidden border-border/80 shadow-sm">
                    <CardHeader className="border-b border-border/60 bg-muted/20">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                            <div className="shrink-0 sm:pt-0.5">
                                <img
                                    src="/mcp-logo-light.svg"
                                    alt="Model Context Protocol"
                                    className="h-7 w-auto sm:h-8 dark:hidden"
                                />
                                <img
                                    src="/mcp-logo-dark.svg"
                                    alt=""
                                    className="hidden h-7 w-auto sm:h-8 dark:block"
                                    aria-hidden
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <CardTitle className="text-xl">Connect your tools</CardTitle>
                                <CardDescription className="mt-1.5">
                                    Connect Cursor, Claude, or other MCP clients using a personal server URL. Each URL
                                    can be revoked anytime.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        {currentWorkspace ? (
                            <>
                                <div className="grid gap-4 sm:max-w-md">
                                    <div className="space-y-2">
                                        <Label htmlFor="mcp-label">Label (optional)</Label>
                                        <Input
                                            id="mcp-label"
                                            placeholder="e.g. Cursor on laptop"
                                            maxLength={128}
                                            value={optionalLabel}
                                            onChange={(e) => setOptionalLabel(e.target.value)}
                                            disabled={createToken.isPending}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Helps you tell connections apart in the list below.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        disabled={createToken.isPending}
                                        onClick={() => createToken.mutate()}
                                    >
                                        {createToken.isPending ? 'Generating…' : 'Generate MCP URL'}
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-sm font-medium text-foreground">Active connections</h3>
                                    {tokensLoading ? (
                                        <p className="text-sm text-muted-foreground">Loading…</p>
                                    ) : sortedTokens.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            No MCP connections yet. Generate a URL to get started.
                                        </p>
                                    ) : isMobile ? (
                                        <ul className="space-y-3">
                                            {sortedTokens.map((row) => (
                                                <li
                                                    key={row.id}
                                                    className={cn(
                                                        'rounded-lg border p-3',
                                                        row.revokedAt && 'opacity-60',
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="font-medium">
                                                                {row.name?.trim() || 'Unnamed'}
                                                            </p>
                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                Created {formatTokenTimestamp(row.createdAt)}
                                                                {row.lastUsedAt
                                                                    ? ` · Last used ${formatTokenTimestamp(row.lastUsedAt)}`
                                                                    : ''}
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                                            {row.revokedAt ? (
                                                                <Badge variant="secondary">Revoked</Badge>
                                                            ) : (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8"
                                                                            onClick={() => setTokenToRevoke(row)}
                                                                            disabled={revokeToken.isPending}
                                                                            aria-label="Revoke connection"
                                                                        >
                                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="bottom">
                                                                        Revoke connection
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Label</TableHead>
                                                    <TableHead>Created</TableHead>
                                                    <TableHead>Last used</TableHead>
                                                    <TableHead className="w-[100px]">Status</TableHead>
                                                    <TableHead className="w-[80px]" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {sortedTokens.map((row) => (
                                                    <TableRow
                                                        key={row.id}
                                                        className={row.revokedAt ? 'opacity-60' : undefined}
                                                    >
                                                        <TableCell className="font-medium">
                                                            {row.name?.trim() || 'Unnamed'}
                                                        </TableCell>
                                                        <TableCell className="whitespace-nowrap">
                                                            {formatTokenTimestamp(row.createdAt)}
                                                        </TableCell>
                                                        <TableCell className="whitespace-nowrap">
                                                            {row.lastUsedAt
                                                                ? formatTokenTimestamp(row.lastUsedAt)
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell>
                                                            {row.revokedAt ? (
                                                                <Badge variant="secondary">Revoked</Badge>
                                                            ) : (
                                                                <Badge variant="outline">Active</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            {!row.revokedAt && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => setTokenToRevoke(row)}
                                                                            disabled={revokeToken.isPending}
                                                                            aria-label="Revoke connection"
                                                                        >
                                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="bottom">
                                                                        Revoke connection
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">Your training data is still being prepared.</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog
                open={createdConnection !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setCreatedConnection(null);
                        setUrlCopied(false);
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Your connection is ready</DialogTitle>
                        <DialogDescription>
                            Copy your URL or access token now — they’re only shown once. Keep them private; they give
                            access to your training data.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="mcp-url-copy">Server URL</Label>
                        <div className="flex min-w-0 gap-2">
                            <Input
                                id="mcp-url-copy"
                                readOnly
                                value={createdConnection?.mcpUrl ?? ''}
                                className="min-w-0 flex-1 font-mono text-xs"
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0 gap-1.5"
                                onClick={() => createdConnection && copyMcpUrl(createdConnection.mcpUrl)}
                            >
                                {urlCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                Copy
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="access-token-copy">Personal access token</Label>
                        <div className="flex gap-2">
                            <Input
                                id="access-token-copy"
                                readOnly
                                value={createdConnection?.token ?? ''}
                                className="min-w-0 font-mono text-xs"
                            />
                            <Button
                                variant="secondary"
                                aria-label="Copy access token"
                                onClick={() => {
                                    if (createdConnection) void copyMcpUrl(createdConnection.token);
                                }}
                            >
                                <Copy />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => setCreatedConnection(null)}>
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={tokenToRevoke !== null} onOpenChange={(open) => !open && setTokenToRevoke(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke this connection?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Clients using this MCP URL will lose access immediately. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => tokenToRevoke && revokeToken.mutate(tokenToRevoke.id)}
                            disabled={revokeToken.isPending}
                        >
                            {revokeToken.isPending ? 'Revoking…' : 'Revoke'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
