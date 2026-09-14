import { getApiBaseUrl } from './api-base-url';
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
import type { McpAccessTokenCreated, McpAccessTokenListItem } from '@/models/mcp';
import type { PaginatedResponse } from '@/models/pagination';
import type {
    ActiveSessionResponse,
    AddSessionExerciseRequest,
    LogSetRequest,
    PatchSessionExerciseRequest,
    SessionDetail,
    SessionSummary,
    StartSessionRequest,
    PatchSetRequest,
    ExerciseHistoryResponse,
} from '@/models/session';
import type {
    PatchRoutineExerciseRequest,
    PatchRoutineRequest,
    RoutineDetail,
    Routine,
    SaveRoutineExerciseRequest,
    SaveRoutineRequest,
} from '@/models/routine';
import type { PatchUserRequest, UserResponse } from '@/models/user';
import { httpClient } from './http-client';

export const authApi = {
    login: (data: LoginRequest) => httpClient.post<void>('/api/v1/auth/login?useSessionCookies=true', data),
    register: (data: RegisterRequest) => httpClient.post<void>('/api/v1/auth/signup', data),
    logout: () => httpClient.post<void>('/api/v1/auth/logout', {}),
    getMe: () => httpClient.get<UserResponse>('/api/v1/me'),
    updateMe: (data: PatchUserRequest) => httpClient.patch<UserResponse>('/api/v1/me', data),
    deleteMe: () => httpClient.delete<void>('/api/v1/me'),
};

export const mcpAccessTokensApi = {
    list: () => httpClient.get<McpAccessTokenListItem[]>('/api/v1/me/mcp-access-tokens'),
    create: (body: { workspaceId: string; name?: string | null }) =>
        httpClient.post<McpAccessTokenCreated>('/api/v1/me/mcp-access-tokens', body),
    revoke: (tokenId: string) => httpClient.delete<void>(`/api/v1/me/mcp-access-tokens/${tokenId}`),
};

/** The workspace's exercise library. */
export const exercisesApi = {
    getAll: (
        workspaceId: string,
        params?: { search?: string; includeArchived?: boolean; page?: number; pageSize?: number },
    ) => httpClient.get<PaginatedResponse<Exercise>>(`/api/v1/workspaces/${workspaceId}/exercises`, { params }),
    getById: async (workspaceId: string, exerciseId: string): Promise<ExerciseDetail & { webUrl: string }> => {
        const exercise = await httpClient.get<ExerciseDetail & { webUrl: string }>(
            `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
        );
        // Private images follow the browser’s API proxy so session cookies work in local previews too.
        return {
            ...exercise,
            images: exercise.images.map((image) => ({
                ...image,
                url: exercise.isCatalog
                    ? image.url
                    : `${getApiBaseUrl()}/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images/${image.id}`,
            })),
        };
    },
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
    getHistory: (workspaceId: string, exerciseId: string, limit = 10) =>
        httpClient.get<ExerciseHistoryResponse>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/history`, {
            params: { limit },
        }),
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

/** The mutable workout-session aggregate. Each successful mutation returns its updated detail. */
export const sessionsApi = {
    getAll: (workspaceId: string, params?: { page?: number; pageSize?: number }) =>
        httpClient.get<PaginatedResponse<SessionSummary>>(`/api/v1/workspaces/${workspaceId}/sessions`, { params }),
    getActive: (workspaceId: string) =>
        httpClient.get<ActiveSessionResponse>(`/api/v1/workspaces/${workspaceId}/sessions/active`),
    getById: (workspaceId: string, sessionId: string) =>
        httpClient.get<SessionDetail & { webUrl: string }>(`/api/v1/workspaces/${workspaceId}/sessions/${sessionId}`),
    start: (workspaceId: string, data: StartSessionRequest = {}) =>
        httpClient.post<SessionDetail>(`/api/v1/workspaces/${workspaceId}/sessions`, data),
    complete: (workspaceId: string, sessionId: string, notes?: string | null) =>
        httpClient.post<SessionDetail>(`/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/complete`, { notes }),
    addExercise: (workspaceId: string, sessionId: string, data: AddSessionExerciseRequest) =>
        httpClient.post<SessionDetail>(`/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises`, data),
    updateExercise: (
        workspaceId: string,
        sessionId: string,
        sessionExerciseId: string,
        data: PatchSessionExerciseRequest,
    ) =>
        httpClient.patch<SessionDetail>(
            `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/${sessionExerciseId}`,
            data,
        ),
    reorderExercises: (workspaceId: string, sessionId: string, sessionExerciseIds: string[]) =>
        httpClient.put<SessionDetail>(`/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/order`, {
            sessionExerciseIds,
        }),
    logSet: (workspaceId: string, sessionId: string, sessionExerciseId: string, data: LogSetRequest) =>
        httpClient.post<SessionDetail>(
            `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/${sessionExerciseId}/sets`,
            data,
        ),
    updateSet: (
        workspaceId: string,
        sessionId: string,
        sessionExerciseId: string,
        setId: string,
        data: PatchSetRequest,
    ) =>
        httpClient.patch<SessionDetail>(
            `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/${sessionExerciseId}/sets/${setId}`,
            data,
        ),
    removeSet: (workspaceId: string, sessionId: string, sessionExerciseId: string, setId: string) =>
        httpClient.delete<SessionDetail>(
            `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/${sessionExerciseId}/sets/${setId}`,
        ),
    abandon: (workspaceId: string, sessionId: string) =>
        httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/sessions/${sessionId}`),
};
