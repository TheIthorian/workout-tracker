import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostHogProvider } from '@posthog/react';
import { createBrowserRouter, createRoutesFromElements, Outlet, Route, RouterProvider } from 'react-router-dom';
import { AnalyticsBridge } from '@/components/AnalyticsBridge';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';

// Every other page loads on demand, so they stay out of the entry chunk.
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const Settings = lazy(() => import('./pages/Settings'));
const RoutinesListPage = lazy(() => import('./pages/routines/RoutinesListPage'));
const RoutineDetailPage = lazy(() => import('./pages/routines/RoutineDetailPage'));
const ExercisesListPage = lazy(() => import('./pages/exercises/ExercisesListPage'));
const ExerciseDetailPage = lazy(() => import('./pages/exercises/ExerciseDetailPage'));
const TodayPage = lazy(() => import('./pages/TodayPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SessionDetailPage = lazy(() => import('./pages/sessions/SessionDetailPage'));
const NotFoundError = lazy(() => import('./pages/NotFoundError'));
const ForbiddenError = lazy(() => import('./pages/ForbiddenError'));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

const posthogOptions = { api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST, defaults: '2026-01-30' } as const;

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;

/**
 * Mounts the PostHog provider only when a key is configured.
 *
 * Rendering the provider without one makes posthog-js log an error on every page load
 * ("PostHog was initialized without a token"). Builds with analytics turned off — local dev, and
 * any deploy without the key set — should simply not have analytics rather than announce a
 * misconfiguration. `usePostHog` falls back to an uninitialised client outside a provider and
 * `useAnalytics` already null-checks it, so callers keep working either way.
 */
const AnalyticsProvider = ({ children }: { children: ReactNode }): JSX.Element =>
    posthogKey ? (
        <PostHogProvider apiKey={posthogKey} options={posthogOptions}>
            {children}
        </PostHogProvider>
    ) : (
        <>{children}</>
    );

/** Router-owned providers keep navigation guards active across app and account routes. */
function SessionLayout(): JSX.Element {
    return (
        <AuthProvider>
            <WorkspaceProvider>
                <AnalyticsBridge />
                <Suspense fallback={<FullPageSpinner />}>
                    <Outlet />
                </Suspense>
            </WorkspaceProvider>
        </AuthProvider>
    );
}

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route element={<SessionLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/403" element={<ForbiddenError />} />
            <Route
                path="/welcome"
                element={
                    <ProtectedRoute>
                        <WelcomePage />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <AppLayout />
                    </ProtectedRoute>
                }
            >
                <Route index element={<TodayPage />} />
                <Route path="today" element={<TodayPage />} />
                <Route path="routines" element={<RoutinesListPage />} />
                <Route path="routines/:routineId" element={<RoutineDetailPage />} />
                <Route path="exercises" element={<ExercisesListPage />} />
                <Route path="exercises/:exerciseId" element={<ExerciseDetailPage />} />
                <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="settings" element={<Settings />} />
            </Route>

            <Route path="*" element={<NotFoundError />} />
        </Route>,
    ),
);

function App(): JSX.Element {
    return (
        <StrictMode>
            <AnalyticsProvider>
                <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
                    <QueryClientProvider client={queryClient}>
                        <TooltipProvider>
                            <Toaster />
                            <Sonner />
                            <RouterProvider router={router} />
                        </TooltipProvider>
                    </QueryClientProvider>
                </ThemeProvider>
            </AnalyticsProvider>
        </StrictMode>
    );
}

export default App;
