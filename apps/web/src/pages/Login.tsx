import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { analyticsEvents, useAnalytics } from '@/lib/analytics';
import { buildAuthPath, readReturnUrl, sanitizeReturnUrl } from '@/lib/return-url';

type LocationState = { from?: { pathname?: string } };

/** The login screen with browser-assisted account fields. */
export default function Login(): JSX.Element {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { capture } = useAnalytics();

    // The returnUrl query parameter survives a full page load (a share link opened cold), the router
    // state does not. Both are sanitized against an allowlist of local paths before we navigate.
    const returnUrl =
        readReturnUrl(location.search) ?? sanitizeReturnUrl((location.state as LocationState)?.from?.pathname);
    const from = returnUrl ?? '/';

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setLoading(true);

        try {
            await login(email, password);
            capture(analyticsEvents.userLoggedIn, { destination_path: from });
            navigate(from, { replace: true });
        } catch (error) {
            // Error handled by http client
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="px-0 pb-7 pt-0">
                    <p className="eyebrow mb-3">Welcome back</p>
                    <CardTitle className="text-4xl">Ready for your next rep?</CardTitle>
                    <CardDescription>Sign in and pick up where you left off.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="email"
                                autoCapitalize="none"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                autoComplete="current-password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                'Sign in'
                            )}
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            Don't have an account?{' '}
                            <Link
                                to={buildAuthPath('/register', returnUrl)}
                                state={{ from: (location.state as LocationState)?.from }}
                                className="font-medium text-primary hover:underline"
                            >
                                Create an account
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </AuthLayout>
    );
}
