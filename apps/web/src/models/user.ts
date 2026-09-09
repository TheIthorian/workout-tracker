import type { WorkspaceListItem } from './workspace';

/** The body of `GET /api/v1/me`. */
export type UserResponse = {
    userId: string;
    displayName: string;
    email: string;
    workspaces: WorkspaceListItem[];
};

export type PatchUserRequest = {
    displayName: string;
};
