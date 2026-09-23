import { getApiBaseUrl } from './api-base-url';
import type { LoginRequest, RegisterRequest } from '@/models/auth';
import type {
    EquipmentPreset,
    OnboardingStage,
    PatchEquipmentPresetRequest,
    SaveEquipmentPresetRequest,
} from '@/models/equipment';
import type {
    Exercise,
    ExerciseDetail,
    ExerciseLink,
    ExerciseSuggestion,
    PatchExerciseLinkRequest,
    PatchExerciseRequest,
    SaveExerciseLinkRequest,
    SaveExercisePreferencesRequest,
    SaveExerciseRequest,
} from '@/models/exercise';
import type { ConnectedApp, McpConnection, OAuthConsentDecision, OAuthConsentRequest } from '@/models/mcp';
import type { MuscleVolumeResponse } from '@/models/muscle';
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
    RoutineListItem,
    RoutineOrder,
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

export const mcpApi = {
    connection: () => httpClient.get<McpConnection>('/api/v1/me/mcp-connection'),
    listConnectedApps: () => httpClient.get<ConnectedApp[]>('/api/v1/me/connected-apps'),
    disconnectApp: (clientId: string) =>
        httpClient.delete<void>(`/api/v1/me/connected-apps?clientId=${encodeURIComponent(clientId)}`),
};

/** The consent screen's half of the OAuth authorization flow. */
export const oauthApi = {
    getConsentRequest: (requestId: string) => httpClient.get<OAuthConsentRequest>(`/api/v1/oauth/consent/${requestId}`),
    decideConsent: (requestId: string, decision: OAuthConsentDecision) =>
        httpClient.post<{ redirectTo: string }>(`/api/v1/oauth/consent/${requestId}`, { decision }),
};

/** The workspace's exercise library. */
export const exercisesApi = {
    getAll: (
        workspaceId: string,
        params?: { search?: string; includeArchived?: boolean; page?: number; pageSize?: number; equipment?: string },
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
    setPreferences: ({
        workspaceId,
        exerciseId,
        data,
    }: {
        workspaceId: string;
        exerciseId: string;
        data: SaveExercisePreferencesRequest;
    }) => httpClient.put<ExerciseDetail>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/preferences`, data),
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
    getSuggestion: (workspaceId: string, exerciseId: string) =>
        httpClient.get<ExerciseSuggestion>(`/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/suggestion`),
};

/** Training summaries derived from completed workout history. */
export const analyticsApi = {
    getMuscleVolume: ({ workspaceId, days }: { workspaceId: string; days: number }) =>
        httpClient.get<MuscleVolumeResponse>(`/api/v1/workspaces/${workspaceId}/analytics/muscle-volume`, {
            params: { days },
        }),
};

/** Named equipment sets for the library filter. */
export const equipmentPresetsApi = {
    list: async (workspaceId: string): Promise<EquipmentPreset[]> =>
        (await httpClient.get<{ data: EquipmentPreset[] }>(`/api/v1/workspaces/${workspaceId}/equipment-presets`)).data,
    create: (workspaceId: string, data: SaveEquipmentPresetRequest) =>
        httpClient.post<EquipmentPreset>(`/api/v1/workspaces/${workspaceId}/equipment-presets`, data),
    update: ({
        workspaceId,
        presetId,
        data,
    }: {
        workspaceId: string;
        presetId: string;
        data: PatchEquipmentPresetRequest;
    }) => httpClient.patch<EquipmentPreset>(`/api/v1/workspaces/${workspaceId}/equipment-presets/${presetId}`, data),
    remove: ({ workspaceId, presetId }: { workspaceId: string; presetId: string }) =>
        httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/equipment-presets/${presetId}`),
};

/** First-run setup progress. */
export const onboardingApi = {
    setStage: ({ workspaceId, stage }: { workspaceId: string; stage: OnboardingStage }) =>
        httpClient.patch<{ stage: OnboardingStage }>(`/api/v1/workspaces/${workspaceId}/onboarding`, { stage }),
};

/** The workspace's routines. Every mutation returns the whole routine, so callers refresh from one shape. */
export const routinesApi = {
    getAll: (
        workspaceId: string,
        params?: { search?: string; includeArchived?: boolean; page?: number; pageSize?: number; sort?: RoutineOrder },
    ) => httpClient.get<PaginatedResponse<RoutineListItem>>(`/api/v1/workspaces/${workspaceId}/routines`, { params }),
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
