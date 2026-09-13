import type { LoginRequest, RegisterRequest } from '@/models/auth';
import type {
    Exercise,
    ExerciseDetail,
    ExerciseLink,
    PatchExerciseLinkRequest,
    PatchExerciseRequest,
    SaveExerciseLinkRequest,
    SaveExerciseRequest,
} from '@/models/exercise';
import type { Item, PatchItemRequest, SaveItemRequest } from '@/models/item';
import type { McpAccessTokenCreated, McpAccessTokenListItem } from '@/models/mcp';
import type { PaginatedResponse } from '@/models/pagination';
import type {
    PatchRoutineExerciseRequest,
    PatchRoutineRequest,
    RoutineDetail,
    Routine,
    SaveRoutineExerciseRequest,
    SaveRoutineRequest,
} from '@/models/routine';
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

/** The workspace's exercise library. */
export const exercisesApi = {
    getAll: (
        workspaceId: string,
        params?: { search?: string; includeArchived?: boolean; page?: number; pageSize?: number },
    ) => httpClient.get<PaginatedResponse<Exercise>>(`/api/v1/workspaces/${workspaceId}/exercises`, { params }),
    getById: (workspaceId: string, exerciseId: string) =>
        httpClient.get<ExerciseDetail & { webUrl: string }>(
            `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
        ),
    create: (workspaceId: string, data: SaveExerciseRequest) =>
        httpClient.post<ExerciseDetail>(`/api/v1/workspaces/${workspaceId}/exercises`, data),
    update: (workspaceId: string, exerciseId: string, data: PatchExerciseRequest) =>
        httpClient.patch<ExerciseDetail>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`, data),
    addLink: ({
        workspaceId,
        exerciseId,
        data,
    }: {
        workspaceId: string;
        exerciseId: string;
        data: SaveExerciseLinkRequest;
    }) => httpClient.post<ExerciseLink>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links`, data),
    updateLink: ({
        workspaceId,
        exerciseId,
        linkId,
        data,
    }: {
        workspaceId: string;
        exerciseId: string;
        linkId: string;
        data: PatchExerciseLinkRequest;
    }) =>
        httpClient.patch<ExerciseLink>(
            `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${linkId}`,
            data,
        ),
    removeLink: ({ workspaceId, exerciseId, linkId }: { workspaceId: string; exerciseId: string; linkId: string }) =>
        httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${linkId}`),
};

/** The workspace's routines. Every mutation returns the whole routine, so callers refresh from one shape. */
export const routinesApi = {
    getAll: (
        workspaceId: string,
        params?: { search?: string; includeArchived?: boolean; page?: number; pageSize?: number },
    ) => httpClient.get<PaginatedResponse<Routine>>(`/api/v1/workspaces/${workspaceId}/routines`, { params }),
    getById: (workspaceId: string, routineId: string) =>
        httpClient.get<RoutineDetail & { webUrl: string }>(`/api/v1/workspaces/${workspaceId}/routines/${routineId}`),
    create: (workspaceId: string, data: SaveRoutineRequest) =>
        httpClient.post<RoutineDetail>(`/api/v1/workspaces/${workspaceId}/routines`, data),
    update: (workspaceId: string, routineId: string, data: PatchRoutineRequest) =>
        httpClient.patch<RoutineDetail>(`/api/v1/workspaces/${workspaceId}/routines/${routineId}`, data),
    addExercise: ({
        workspaceId,
        routineId,
        data,
    }: {
        workspaceId: string;
        routineId: string;
        data: SaveRoutineExerciseRequest;
    }) => httpClient.post<RoutineDetail>(`/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises`, data),
    updateExercise: ({
        workspaceId,
        routineId,
        routineExerciseId,
        data,
    }: {
        workspaceId: string;
        routineId: string;
        routineExerciseId: string;
        data: PatchRoutineExerciseRequest;
    }) =>
        httpClient.patch<RoutineDetail>(
            `/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises/${routineExerciseId}`,
            data,
        ),
    removeExercise: ({
        workspaceId,
        routineId,
        routineExerciseId,
    }: {
        workspaceId: string;
        routineId: string;
        routineExerciseId: string;
    }) =>
        httpClient.delete<RoutineDetail>(
            `/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises/${routineExerciseId}`,
        ),
    replaceExercises: ({
        workspaceId,
        routineId,
        exercises,
    }: {
        workspaceId: string;
        routineId: string;
        exercises: SaveRoutineExerciseRequest[];
    }) =>
        httpClient.put<RoutineDetail>(`/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises`, {
            exercises,
        }),
};
