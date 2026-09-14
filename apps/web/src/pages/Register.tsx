import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { toast } from '@/hooks/use-toast';
import { analyticsEvents, useAnalytics } from '@/lib/analytics';
import { buildAuthPath, readReturnUrl, sanitizeReturnUrl } from '@/lib/return-url';

/** The register screen with browser-assisted account fields. */
export default function Register(): JSX.Element {
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setLoading] = useState(false);
    const { register } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { capture } = useAnalytics();
    const from = (location.state as { from?: { pathname?: string } })?.from;
    // Keep whatever link brought the visitor here (e.g. a workspace invite) across sign-up.
    const returnUrl = readReturnUrl(location.search) ?? sanitizeReturnUrl(from?.pathname);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();

        if (password !== confirmPassword) {
            toast({
                title: 'Passwords do not match',
                description: 'Please ensure your passwords match',
                variant: 'destructive',
            });
            return;
        }

        setLoading(true);

        try {
            await register(email, password, displayName || undefined);
            capture(analyticsEvents.userRegistered, { has_display_name: !!displayName.trim() });
            toast({
                title: 'Your account is ready',
                description: 'Sign in to start your first workout.',
            });
            navigate(buildAuthPath('/login', returnUrl), { replace: true, state: from ? { from } : undefined });
        } catch {
            // The HTTP client displays the server’s validation message.
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="px-0 pb-7 pt-0">
                    <p className="eyebrow mb-3">Let’s get started</p>
                    <CardTitle className="text-4xl">Make room for progress.</CardTitle>
                    <CardDescription>A space for your exercises, routines, and small wins.</CardDescription>
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
                            <Label htmlFor="displayName">Display name (optional)</Label>
                            <Input
                                id="displayName"
                                type="text"
                                placeholder="What should we call you?"
                                autoComplete="nickname"
                                maxLength={100}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                autoComplete="new-password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={isLoading}
                                minLength={8}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm password</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                autoComplete="new-password"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                disabled={isLoading}
                                minLength={8}
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating account...
                                </>
                            ) : (
                                'Create account'
                            )}
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            Already have an account?{' '}
                            <Link
                                to={buildAuthPath('/login', returnUrl)}
                                state={from ? { from } : undefined}
                                className="font-medium text-primary hover:underline"
                            >
                                Sign in
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </AuthLayout>
    );
}
