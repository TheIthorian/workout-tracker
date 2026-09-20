import { Link, useSearchParams } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The OAuth error code that means the client did not identify itself in a way this server reads. */
const UNSUPPORTED_CLIENT = 'unsupported_client';

/**
 * Where the authorization endpoint sends a browser when it cannot trust the client enough to
 * redirect the failure back to it — an unregistered `redirect_uri` or a client from a domain this
 * deployment does not accept. Redirecting either of those back to the client would be an open
 * redirect, so the failure is shown here instead.
 */
export default function OAuthErrorPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const error = searchParams.get('error') ?? '';
    const description = searchParams.get('error_description');
    const clientId = searchParams.get('client_id');

    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
            <Card>
                <CardHeader className="space-y-3">
                    <ShieldX className="h-8 w-8 text-destructive" aria-hidden />
                    <CardTitle className="text-2xl">
                        {error === UNSUPPORTED_CLIENT ? 'This app cannot connect' : 'That request was refused'}
                    </CardTitle>
                    <CardDescription>
                        {error === UNSUPPORTED_CLIENT
                            ? 'An app has to identify itself with a public metadata document, and this one did not.'
                            : 'The app sent a request this server could not accept.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                    {clientId && (
                        <p className="text-xs text-muted-foreground break-all">
                            Client: <span className="font-mono">{clientId}</span>
                        </p>
                    )}
                    <Button asChild size="lg" className="h-12 w-full">
                        <Link to="/settings">Back to settings</Link>
                    </Button>
                </CardContent>
            </Card>
        </main>
    );
}
