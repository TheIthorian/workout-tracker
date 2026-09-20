import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { Check, Copy, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mcpApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { analyticsEvents, useAnalytics } from '@/lib/analytics';
import type { ConnectedApp } from '@/models/mcp';

function formatTimestamp(iso: string): string {
    try {
        return formatDate(iso);
    } catch {
        return iso;
    }
}

/**
 * Connecting an MCP client is the client's job now: the user pastes one URL, and the client walks
 * them through the sign-in and consent screens itself. Nothing on this page hands out a credential,
 * which is why there is nothing here to copy except a public address.
 */
export function IntegrationsSettings(): JSX.Element {
    const queryClient = useQueryClient();
    const { capture } = useAnalytics();

    const [urlCopied, setUrlCopied] = useState(false);
    const [appToDisconnect, setAppToDisconnect] = useState<ConnectedApp | null>(null);

    const { data: connection } = useQuery({
        queryKey: ['mcp-connection'],
        queryFn: () => mcpApi.connection(),
    });

    const { data: apps = [], isLoading: appsLoading } = useQuery({
        queryKey: ['connected-apps'],
        queryFn: () => mcpApi.listConnectedApps(),
    });

    const disconnect = useMutation({
        mutationFn: (clientId: string) => mcpApi.disconnectApp(clientId),
        onSuccess: () => {
            capture(analyticsEvents.mcpAppDisconnected);
            queryClient.invalidateQueries({ queryKey: ['connected-apps'] });
            toast({ title: 'App disconnected' });
            setAppToDisconnect(null);
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

    const sortedApps = [...apps].sort((a, b) => parseISO(b.connectedAt).getTime() - parseISO(a.connectedAt).getTime());

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
                                    Add this server URL in Claude, Cursor, or another MCP client. It will send you here
                                    to sign in and approve the connection — no keys to copy or keep safe.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="space-y-2">
                            <Label htmlFor="mcp-url">Server URL</Label>
                            <div className="flex min-w-0 gap-2">
                                <Input
                                    id="mcp-url"
                                    readOnly
                                    value={connection?.mcpUrl ?? ''}
                                    className="min-w-0 flex-1 font-mono text-xs"
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="h-11 shrink-0 gap-1.5"
                                    disabled={!connection}
                                    onClick={() => connection && copyMcpUrl(connection.mcpUrl)}
                                >
                                    {urlCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    Copy
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Safe to share with an MCP client — it carries no credential of its own.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h3 className="text-sm font-medium text-foreground">Connected apps</h3>
                            {appsLoading ? (
                                <p className="text-sm text-muted-foreground">Loading…</p>
                            ) : sortedApps.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No apps connected yet. Add the URL above in your MCP client to get started.
                                </p>
                            ) : (
                                <ul className="space-y-3">
                                    {sortedApps.map((app) => (
                                        <li key={app.clientId} className="rounded-lg border p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-medium">{app.clientName}</p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Connected {formatTimestamp(app.connectedAt)}
                                                        {app.lastUsedAt
                                                            ? ` · Last used ${formatTimestamp(app.lastUsedAt)}`
                                                            : ''}
                                                    </p>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-11 w-11 shrink-0"
                                                    onClick={() => setAppToDisconnect(app)}
                                                    disabled={disconnect.isPending}
                                                    aria-label={`Disconnect ${app.clientName}`}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <AlertDialog open={appToDisconnect !== null} onOpenChange={(open) => !open && setAppToDisconnect(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {appToDisconnect?.clientName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            It will lose access to your training data immediately. You can connect it again later.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => appToDisconnect && disconnect.mutate(appToDisconnect.clientId)}
                            disabled={disconnect.isPending}
                        >
                            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
