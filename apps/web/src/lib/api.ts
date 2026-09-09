import type { LoginRequest, RegisterRequest } from '@/models/auth';
import type { Item, PatchItemRequest, SaveItemRequest } from '@/models/item';
import type { McpAccessTokenCreated, McpAccessTokenListItem } from '@/models/mcp';
import type { PaginatedResponse } from '@/models/pagination';
import type { PatchUserRequest, UserResponse } from '@/models/user';
import type {
    PostWorkspaceMemberRequest,
    PostWorkspaceRequest,
    WorkspaceResponse,
    WorkspaceRole,
} from '@/models/workspace';
import { httpClient } from './http-client';

export const authApi = {
    login: (data: LoginRequest) => httpClient.post<void>('/api/v1/auth/login?useSessionCookies=true', data),
    register: (data: RegisterRequest) => httpClient.post<void>('/api/v1/auth/signup', data),
    logout: () => httpClient.post<void>('/api/v1/auth/logout', {}),
    getMe: () => httpClient.get<UserResponse>('/api/v1/me'),
    updateMe: (data: PatchUserRequest) => httpClient.patch<UserResponse>('/api/v1/me', data),
    deleteMe: () => httpClient.delete<void>('/api/v1/me'),
};

export const workspacesApi = {
    getAll: () => httpClient.get<WorkspaceResponse[]>('/api/v1/workspaces'),
    getById: (workspaceId: string) => httpClient.get<WorkspaceResponse>(`/api/v1/workspaces/${workspaceId}`),
    create: (data: PostWorkspaceRequest) => httpClient.post<WorkspaceResponse>('/api/v1/workspaces', data),
    update: (workspaceId: string, data: Partial<PostWorkspaceRequest>) =>
        httpClient.patch<WorkspaceResponse>(`/api/v1/workspaces/${workspaceId}`, data),
    remove: (workspaceId: string) => httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}`),
    addMember: (workspaceId: string, data: PostWorkspaceMemberRequest) =>
        httpClient.post<void>(`/api/v1/workspaces/${workspaceId}/members`, data),
    updateMemberRole: (workspaceId: string, userId: string, role: WorkspaceRole) =>
        httpClient.patch<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, { role }),
    removeMember: (workspaceId: string, userId: string) =>
        httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`),
};

export const mcpAccessTokensApi = {
    list: () => httpClient.get<McpAccessTokenListItem[]>('/api/v1/me/mcp-access-tokens'),
    create: (body: { workspaceId: string; name?: string | null }) =>
        httpClient.post<McpAccessTokenCreated>('/api/v1/me/mcp-access-tokens', body),
    revoke: (tokenId: string) => httpClient.delete<void>(`/api/v1/me/mcp-access-tokens/${tokenId}`),
};

/**
 * The example resource. It is the one feature slice this template ships end to end — contract,
 * controller, service, table, and these calls — so a new project has a working shape to copy.
 */
export const itemsApi = {
    getAll: (workspaceId: string, params?: { page?: number; pageSize?: number }) =>
        httpClient.get<PaginatedResponse<Item>>(`/api/v1/workspaces/${workspaceId}/items`, { params }),
    getById: (workspaceId: string, itemId: string) =>
        httpClient.get<Item>(`/api/v1/workspaces/${workspaceId}/items/${itemId}`),
    create: (workspaceId: string, data: SaveItemRequest) =>
        httpClient.post<Item>(`/api/v1/workspaces/${workspaceId}/items`, data),
    update: (workspaceId: string, itemId: string, data: PatchItemRequest) =>
        httpClient.patch<Item>(`/api/v1/workspaces/${workspaceId}/items/${itemId}`, data),
    remove: (workspaceId: string, itemId: string) =>
        httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/items/${itemId}`),
};
