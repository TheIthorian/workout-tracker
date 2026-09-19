import { Navigate, useLocation } from 'react-router-dom';
import { AuthStatus, useAuth } from '@/contexts/AuthContext';
import { ConnectionLost } from '@/components/ConnectionLost';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { buildAuthPath } from '@/lib/return-url';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, status, refreshUser } = useAuth();
    const location = useLocation();

    if (status === AuthStatus.Loading) {
        return <FullPageSpinner />;
    }

    // Only a 401 means signed out. An unreachable API says nothing about the session, so offer a
    // retry rather than a sign-in page that would discard the route someone was mid-workout on.
    if (status === AuthStatus.Unreachable && !user) {
        return <ConnectionLost onRetry={refreshUser} />;
    }

    if (!user) {
        const loginPath = buildAuthPath('/login', `${location.pathname}${location.search}${location.hash}`);
        return <Navigate to={loginPath} state={{ from: location }} replace />;
    }

    return <>{children}</>;
}
