import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { useAuth } from '@/contexts/AuthContext';
import { oauthApi } from '@/lib/api';
import { analyticsEvents, useAnalytics } from '@/lib/analytics';
import type { OAuthConsentDecision } from '@/models/mcp';

/** What approving actually grants. One scope, so this is prose rather than a checklist. */
const GRANTED_CAPABILITIES = [
    'Read your exercises, routines and workout history',
    'Create and update exercises and routines',
    'Start, log and finish workout sessions',
];

/**
 * The consent screen. It is reached by a full-page redirect from the API's authorization endpoint,
 * and it leaves the same way — approving hands back a URL on the client, which this navigates to
 * with `window.location.assign` rather than the router, because the destination is another origin.
 */
export default function OAuthConsentPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const requestId = searchParams.get('request_id') ?? '';
    const { user } = useAuth();
    const { capture } = useAnalytics();
    const [decided, setDecided] = useState(false);

    const {
        data: request,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['oauth-consent', requestId],
        queryFn: () => oauthApi.getConsentRequest(requestId),
        enabled: requestId.length > 0,
        retry: false,
    });

    const decide = useMutation({
        mutationFn: (decision: OAuthConsentDecision) => oauthApi.decideConsent(requestId, decision),
        onSuccess: ({ redirectTo }, decision) => {
            if (decision === 'approve') capture(analyticsEvents.mcpAppConnected);

            setDecided(true);
            window.location.assign(redirectTo);
        },
    });

    if (requestId.length === 0 || isError) return <ExpiredRequest />;

    if (isLoading || !request) return <FullPageSpinner />;

    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
            <Card>
                <CardHeader className="space-y-3">
                    <ShieldCheck className="h-8 w-8 text-primary" aria-hidden />
                    <CardTitle className="text-2xl">Connect {request.clientName} to your training data?</CardTitle>
                    <CardDescription>
                        {request.previouslyApproved
                            ? 'You have connected this app before. Approving again issues it a fresh key.'
                            : 'Approve only if you started this from the app itself.'}
                        {user ? ` Signed in as ${user.email}.` : ''}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <section aria-labelledby="consent-grants" className="space-y-3">
                        <h2 id="consent-grants" className="text-sm font-medium">
                            It will be able to
                        </h2>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            {GRANTED_CAPABILITIES.map((capability) => (
                                <li key={capability} className="flex gap-2">
                                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                                    {capability}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section aria-labelledby="consent-destination" className="space-y-2">
                        <h2 id="consent-destination" className="text-sm font-medium">
                            You will be sent to
                        </h2>
                        <ul className="space-y-1 text-sm">
                            {request.redirectHosts.map((host) => (
                                <li key={host} className="font-mono text-xs break-all">
                                    {host}
                                </li>
                            ))}
                        </ul>
                        <p className="text-xs text-muted-foreground break-all">
                            Identified by <span className="font-mono">{request.clientId}</span>
                        </p>
                        {(request.tosUri || request.policyUri) && (
                            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                {request.tosUri && <ExternalLink href={request.tosUri} label="Terms" />}
                                {request.policyUri && <ExternalLink href={request.policyUri} label="Privacy" />}
                            </p>
                        )}
                    </section>

                    <div className="flex flex-col gap-3">
                        <Button
                            size="lg"
                            className="h-12"
                            disabled={decide.isPending || decided}
                            onClick={() => decide.mutate('approve')}
                        >
                            {decide.isPending || decided ? 'Connecting…' : 'Connect'}
                        </Button>
                        <Button
                            variant="ghost"
                            size="lg"
                            className="h-12"
                            disabled={decide.isPending || decided}
                            onClick={() => decide.mutate('deny')}
                        >
                            Cancel
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        You can disconnect this app at any time from Settings → Integrations.
                    </p>
                </CardContent>
            </Card>
        </main>
    );
}

function ExpiredRequest(): JSX.Element {
    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
            <Card>
                <CardHeader className="space-y-3">
                    <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
                    <CardTitle className="text-2xl">This request has expired</CardTitle>
                    <CardDescription>
                        Authorization requests are short-lived. Start the connection again from the app you were
                        connecting.
                    </CardDescription>
                </CardHeader>
            </Card>
        </main>
    );
}

function ExternalLink({ href, label }: { href: string; label: string }): JSX.Element {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 underline underline-offset-4"
        >
            {label}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
    );
}
