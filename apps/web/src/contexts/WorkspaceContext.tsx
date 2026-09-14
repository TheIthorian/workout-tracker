import { createContext, useContext, ReactNode } from 'react';
import { WorkspaceListItem } from '@/models/workspace';
import { useAuth } from './AuthContext';

interface WorkspaceContextType {
    currentWorkspace?: WorkspaceListItem;
    workspaceId: string;
    isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isLoading } = useAuth();
    const currentWorkspace = user?.workspaces[0];

    return (
        <WorkspaceContext.Provider
            value={{
                currentWorkspace,
                workspaceId: currentWorkspace?.workspaceId ?? '',
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
