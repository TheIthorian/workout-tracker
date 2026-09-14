import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { AppBottomNav } from '@/components/layout/AppBottomNav';
import { AppTopNav } from '@/components/layout/AppTopNav';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import NotFoundError from '@/pages/NotFoundError';

/** The signed-in shell for every workspace-scoped route: header, content outlet, mobile tab bar. */
export function AppLayout(): JSX.Element {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const { setCurrentWorkspaceId, workspaces, isLoading } = useWorkspace();
    const validWorkspace = workspaces.some((workspace) => workspace.workspaceId === workspaceId);
    useEffect(() => {
        if (validWorkspace) setCurrentWorkspaceId(workspaceId);
    }, [setCurrentWorkspaceId, workspaceId, validWorkspace]);
    if (!isLoading && !validWorkspace) return <NotFoundError />;

    return (
        <div className="flex min-h-screen flex-col bg-background md:flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <AppTopNav workspaceId={workspaceId} />

                <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-4"
                >
                    Skip to content
                </a>
                <main id="main-content" className="min-w-0 flex-1 pb-24 md:pb-8">
                    <Outlet />
                </main>

                <AppBottomNav workspaceId={workspaceId} />
            </div>
        </div>
    );
}
