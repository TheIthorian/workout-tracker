import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { AppBottomNav } from '@/components/layout/AppBottomNav';
import { AppTopNav } from '@/components/layout/AppTopNav';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import NotFoundError from '@/pages/NotFoundError';

/** The signed-in shell for every workspace-scoped route: header, content outlet, mobile tab bar. */
export function AppLayout() {
    const { workspaceId = '' } = useParams<{ workspaceId: string }>();
    const { setCurrentWorkspaceId } = useWorkspace();
    const [workspaceInvalid, setWorkspaceInvalid] = useState(false);

    useEffect(() => {
        if (!workspaceId) return;
        try {
            setCurrentWorkspaceId(workspaceId);
        } catch {
            setWorkspaceInvalid(true);
        }
    }, [setCurrentWorkspaceId, workspaceId]);

    if (workspaceInvalid) {
        return <NotFoundError />;
    }

    return (
        <div className='flex min-h-screen flex-col bg-background md:flex-row'>
            <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
                <AppTopNav workspaceId={workspaceId} />

                <main className='flex-1 pb-20 md:pb-0'>
                    <Outlet />
                </main>

                <AppBottomNav workspaceId={workspaceId} />
            </div>
        </div>
    );
}
