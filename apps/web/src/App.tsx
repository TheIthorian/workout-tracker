import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostHogProvider } from '@posthog/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AnalyticsBridge } from '@/components/AnalyticsBridge';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceRedirect } from '@/components/WorkspaceRedirect';
import { AuthProvider } from '@/contexts/AuthContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';

// The item list is the landing route for a signed-in user, so it stays a static import:
// splitting it would only add a second round trip in front of the page people actually see.
import ItemsListPage from './pages/items/ItemsListPage';

// Every other page loads on demand, so they stay out of the entry chunk.
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Settings = lazy(() => import('./pages/Settings'));
const SettingsRedirectPage = lazy(() => import('./pages/SettingsRedirectPage'));
const ItemDetailPage = lazy(() => import('./pages/items/ItemDetailPage'));
const ExercisesListPage = lazy(() => import('./pages/exercises/ExercisesListPage'));
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
const AnalyticsProvider = ({ children }: { children: ReactNode }) =>
    posthogKey ? (
        <PostHogProvider apiKey={posthogKey} options={posthogOptions}>
            {children}
        </PostHogProvider>
    ) : (
        <>{children}</>
    );

const App = () => (
    <StrictMode>
        <AnalyticsProvider>
            <ThemeProvider defaultTheme='system' storageKey='vite-ui-theme'>
                <QueryClientProvider client={queryClient}>
                    <TooltipProvider>
                        <Toaster />
                        <Sonner />
                        <BrowserRouter>
                            <AuthProvider>
                                <WorkspaceProvider>
                                    <AnalyticsBridge />
                                    <Suspense fallback={<FullPageSpinner />}>
                                        <Routes>
                                            <Route path='/' element={<WorkspaceRedirect />} />
                                            <Route path='/login' element={<Login />} />
                                            <Route path='/register' element={<Register />} />
                                            <Route path='/403' element={<ForbiddenError />} />

                                            <Route
                                                path='/settings'
                                                element={
                                                    <ProtectedRoute>
                                                        <SettingsRedirectPage />
                                                    </ProtectedRoute>
                                                }
                                            />

                                            <Route
                                                path='/workspaces/:workspaceId'
                                                element={
                                                    <ProtectedRoute>
                                                        <AppLayout />
                                                    </ProtectedRoute>
                                                }
                                            >
                                                <Route index element={<ItemsListPage />} />
                                                <Route path='items/:itemId' element={<ItemDetailPage />} />
                                                <Route path='exercises' element={<ExercisesListPage />} />
                                                <Route path='settings' element={<Settings />} />
                                            </Route>

                                            <Route path='*' element={<NotFoundError />} />
                                        </Routes>
                                    </Suspense>
                                </WorkspaceProvider>
                            </AuthProvider>
                        </BrowserRouter>
                    </TooltipProvider>
                </QueryClientProvider>
            </ThemeProvider>
        </AnalyticsProvider>
    </StrictMode>
);

export default App;
