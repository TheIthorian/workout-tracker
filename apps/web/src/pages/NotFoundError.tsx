import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Home, Search } from 'lucide-react';

/** A recoverable missing page state. */
export default function NotFoundError(): JSX.Element {
    const navigate = useNavigate();

    return (
        <div className="flex min-h-[75dvh] items-center justify-center bg-background px-4">
            <div className="text-center space-y-6 animate-fade-in">
                {/* Illustration placeholder */}
                <div className="relative mx-auto w-40 h-40 mb-6">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative">
                            <Search className="h-20 w-20 text-muted-foreground/20" />
                            <div className="absolute -right-4 -top-4 rounded-full bg-destructive/10 p-4">
                                <span className="text-4xl font-bold text-destructive">404</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight">This page stepped out.</h1>
                    <p className="text-lg text-muted-foreground max-w-md mx-auto">
                        We can’t find that page. It may have moved or is no longer available.
                    </p>
                </div>

                <div className="flex flex-wrap gap-3 justify-center">
                    <Button onClick={() => navigate(-1)} variant="outline">
                        Go back
                    </Button>
                    <Button onClick={() => navigate('/')}>
                        <Home className="mr-2 h-4 w-4" />
                        Back to today
                    </Button>
                </div>
            </div>
        </div>
    );
}
