import { computeSessionState } from '@app/domain';
import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
    type InfiniteData,
    type UseInfiniteQueryResult,
    type UseMutationResult,
    type UseQueryResult,
} from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';
import { randomUuid } from '@/lib/random-uuid';
import type { PaginatedResponse } from '@/models/pagination';
import type {
    ActiveSessionResponse,
    AddSessionExerciseRequest,
    LogSetRequest,
    PatchSessionExerciseRequest,
    PatchSetRequest,
    SessionDetail,
    SessionSummary,
    StartSessionRequest,
} from '@/models/session';

type SessionAction<TVariables> = { sessionId: string; variables: TVariables };

/** Lists workouts newest first, including completed sessions for history. */
export function useSessions({
    workspaceId,
}: {
    workspaceId: string;
}): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<SessionSummary>>, Error> {
    return useInfiniteQuery({
        queryKey: ['sessions', workspaceId, 'list'],
        queryFn: ({ pageParam }) => sessionsApi.getAll(workspaceId, { page: pageParam }),
        initialPageParam: 1,
        getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
        enabled: Boolean(workspaceId),
    });
}

/** Gets the user's one active workout, if they have one. */
export function useActiveSession({
    workspaceId,
}: {
    workspaceId: string;
}): UseQueryResult<ActiveSessionResponse, Error> {
    return useQuery({
        queryKey: ['sessions', workspaceId, 'active'],
        queryFn: () => sessionsApi.getActive(workspaceId),
        enabled: Boolean(workspaceId),
    });
}

/** Gets a single workout aggregate. */
export function useSession({
    workspaceId,
    sessionId,
}: {
    workspaceId: string;
    sessionId: string;
}): UseQueryResult<SessionDetail, Error> {
    return useQuery({
        queryKey: sessionKey({ workspaceId, sessionId }),
        queryFn: () => sessionsApi.getById(workspaceId, sessionId),
        enabled: Boolean(workspaceId && sessionId),
    });
}

/** Starts a blank workout or snapshots a routine into one. */
export function useStartSession({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<SessionDetail, Error, StartSessionRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data) => sessionsApi.start(workspaceId, data),
        onSuccess: (session) => writeSession({ queryClient, workspaceId, session }),
    });
}

/** Adds an ad-hoc exercise to an active workout. */
export function useAddSessionExercise({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<SessionDetail, Error, SessionAction<AddSessionExerciseRequest>> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) => sessionsApi.addExercise(workspaceId, sessionId, variables),
    });
}

/** Updates an active exercise, including its skipped status. */
export function useUpdateSessionExercise({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<
    SessionDetail,
    Error,
    SessionAction<{ sessionExerciseId: string; data: PatchSessionExerciseRequest }>
> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) =>
            sessionsApi.updateExercise(workspaceId, sessionId, variables.sessionExerciseId, variables.data),
    });
}

/** Persists the complete exercise order for an active workout. */
export function useReorderSessionExercises({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<SessionDetail, Error, SessionAction<string[]>> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) => sessionsApi.reorderExercises(workspaceId, sessionId, variables),
    });
}

/** Completes a workout after it has at least one working set. */
export function useCompleteSession({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<SessionDetail, Error, SessionAction<string | null | undefined>> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) => sessionsApi.complete(workspaceId, sessionId, variables),
    });
}

/** Corrects a recorded set in an active or completed workout. */
export function useUpdateSessionSet({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<
    SessionDetail,
    Error,
    SessionAction<{ sessionExerciseId: string; setId: string; data: PatchSetRequest }>
> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) =>
            sessionsApi.updateSet(workspaceId, sessionId, variables.sessionExerciseId, variables.setId, variables.data),
    });
}

/** Deletes a mistaken set and lets the API renumber the remaining entries. */
export function useRemoveSessionSet({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<SessionDetail, Error, SessionAction<{ sessionExerciseId: string; setId: string }>> {
    return useSessionMutation({
        workspaceId,
        mutationFn: ({ sessionId, variables }) =>
            sessionsApi.removeSet(workspaceId, sessionId, variables.sessionExerciseId, variables.setId),
    });
}

/** Permanently abandons an active workout. */
export function useAbandonSession({ workspaceId }: { workspaceId: string }): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (sessionId) => sessionsApi.abandon(workspaceId, sessionId),
        onSuccess: (_result, sessionId) => {
            queryClient.removeQueries({ queryKey: sessionKey({ workspaceId, sessionId }) });
            queryClient.setQueryData<ActiveSessionResponse>(['sessions', workspaceId, 'active'], { session: null });
            queryClient.invalidateQueries({ queryKey: ['sessions', workspaceId, 'list'] });
        },
    });
}

/**
 * Logs a set with a local response immediately, then replaces it with the server aggregate.
 * A rejected request restores the exact prior aggregate and refetches, so a delayed response never
 * leaves the workout screen with a fabricated set.
 */
export function useLogSet({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<
    SessionDetail,
    Error,
    SessionAction<{ sessionExerciseId: string; data: LogSetRequest }>,
    { previous: SessionDetail | undefined }
> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ sessionId, variables }) =>
            sessionsApi.logSet(workspaceId, sessionId, variables.sessionExerciseId, variables.data),
        retry: 1,
        onMutate: async ({ sessionId, variables }) => {
            const key = sessionKey({ workspaceId, sessionId });
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<SessionDetail>(key);
            if (previous) {
                const now = new Date().toISOString();
                const exercises = previous.exercises.map((exercise) => {
                    if (exercise.id !== variables.sessionExerciseId) return exercise;
                    return {
                        ...exercise,
                        sets: [
                            ...exercise.sets,
                            {
                                id: `optimistic-${randomUuid()}`,
                                setIndex: exercise.sets.length + 1,
                                completedAt: now,
                                isWarmup: variables.data.isWarmup ?? false,
                                rpe: variables.data.rpe ?? null,
                                weightKg: variables.data.weightKg ?? null,
                                reps: variables.data.reps ?? null,
                                durationSeconds: variables.data.durationSeconds ?? null,
                                distanceM: variables.data.distanceM ?? null,
                            },
                        ],
                    };
                });
                queryClient.setQueryData<SessionDetail>(key, {
                    ...previous,
                    exercises,
                    state: computeSessionState({ completedAt: previous.completedAt, exercises }),
                });
            }
            return { previous };
        },
        onError: (_error, { sessionId }, context) => {
            const key = sessionKey({ workspaceId, sessionId });
            queryClient.setQueryData(key, context?.previous);
            queryClient.invalidateQueries({ queryKey: key });
        },
        onSuccess: (session) => writeSession({ queryClient, workspaceId, session }),
    });
}

/** Shares the normal mutation lifecycle for session actions that return a full aggregate. */
function useSessionMutation<TVariables>({
    workspaceId,
    mutationFn,
}: {
    workspaceId: string;
    mutationFn: (action: SessionAction<TVariables>) => Promise<SessionDetail>;
}): UseMutationResult<SessionDetail, Error, SessionAction<TVariables>> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onSuccess: (session) => writeSession({ queryClient, workspaceId, session }),
    });
}

/** Writes the canonical aggregate everywhere it can be on screen, then refreshes summaries. */
function writeSession({
    queryClient,
    workspaceId,
    session,
}: {
    queryClient: ReturnType<typeof useQueryClient>;
    workspaceId: string;
    session: SessionDetail;
}): void {
    queryClient.setQueryData<SessionDetail>(sessionKey({ workspaceId, sessionId: session.id }), session);
    queryClient.setQueryData<ActiveSessionResponse>(['sessions', workspaceId, 'active'], {
        session: session.completedAt ? null : session,
    });
    queryClient.invalidateQueries({ queryKey: ['sessions', workspaceId, 'list'] });
    for (const exercise of session.exercises) {
        queryClient.invalidateQueries({
            queryKey: ['exercises', workspaceId, exercise.exercise.id, 'history'],
        });

        // A suggestion only moves once the session is finished, so refetching per logged set would
        // double the requests a workout makes and never change an answer.
        if (session.completedAt !== null) {
            queryClient.invalidateQueries({
                queryKey: ['exercises', workspaceId, exercise.exercise.id, 'suggestion'],
            });
        }
    }
}

/** Builds the stable detail-query key shared by reads, optimistic updates, and mutations. */
function sessionKey({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }): readonly string[] {
    return ['sessions', workspaceId, sessionId];
}
