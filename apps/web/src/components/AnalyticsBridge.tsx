import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
    resetAnalyticsUser,
    syncAnalyticsUser,
    syncAnalyticsWorkspace,
    trackScreenView,
    useAnalytics,
} from '@/lib/analytics';

export function AnalyticsBridge() {
    const location = useLocation();
    const { user, isLoading } = useAuth();
    const { currentWorkspace } = useWorkspace();
    const { posthog } = useAnalytics();
    const analyticsWorkspace = currentWorkspace;

    useEffect(() => {
        if (!posthog || isLoading) return;

        if (user) {
            syncAnalyticsUser(posthog, user);
            return;
        }

        resetAnalyticsUser(posthog);
    }, [isLoading, posthog, user]);

    useEffect(() => {
        if (!posthog) return;

        syncAnalyticsWorkspace(posthog, analyticsWorkspace);
    }, [analyticsWorkspace, posthog]);

    useEffect(() => {
        if (!posthog) return;

        trackScreenView(posthog, location.pathname, location.search, analyticsWorkspace);
    }, [analyticsWorkspace, location.pathname, location.search, posthog]);

    return null;
}
