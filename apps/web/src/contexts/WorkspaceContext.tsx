import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { WorkspaceListItem } from '@/models/workspace';
import { useAuth } from './AuthContext';

interface WorkspaceContextType {
    workspaces: WorkspaceListItem[];
    currentWorkspace?: WorkspaceListItem;
    setCurrentWorkspaceId: (workspaceId: string | null) => void;
    isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isLoading } = useAuth();
    const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);

    const setCurrentWorkspaceId = useCallback((newWorkspaceId: string | null): void => {
        setCurrentWorkspaceIdState(newWorkspaceId);
    }, []);

    return (
        <WorkspaceContext.Provider
            value={{
                workspaces: user?.workspaces ?? [],
                currentWorkspace:
                    user?.workspaces?.find((w) => w.workspaceId === currentWorkspaceId) ?? user?.workspaces?.[0],
                setCurrentWorkspaceId,
                isLoading: isLoading,
            }}
        >
            {children}
        </WorkspaceContext.Provider>
    );
}

export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (context === undefined) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return context;
}
