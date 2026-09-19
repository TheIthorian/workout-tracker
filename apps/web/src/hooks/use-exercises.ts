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
import { exercisesApi } from '@/lib/api';
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
import type { ExerciseHistoryResponse } from '@/models/session';
import type { PaginatedResponse } from '@/models/pagination';
import type { Equipment } from '@/models/equipment';

/**
 * The user's exercise library, optionally filtered by name, one page at a time.
 *
 * A gym-use list can outgrow the API's default page size, so this loads more pages on demand
 * (`fetchNextPage`) rather than capping at the first one — nothing in the library may become
 * permanently unreachable. `search` is assumed already normalised (trimmed) by the caller: this
 * hook uses it verbatim as both the cache key and the request filter, so it can't drift from what
 * was actually searched for.
 */
export function useExercises({
    workspaceId,
    search,
    includeArchived = false,
    equipment,
}: {
    workspaceId: string;
    search?: string;
    includeArchived?: boolean;
    equipment?: Equipment[];
}): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Exercise>>, Error> {
    return useInfiniteQuery({
        queryKey: [
            'exercises',
            workspaceId,
            { search: search ?? '', includeArchived, equipment: equipment?.join(',') ?? null },
        ],
        queryFn: ({ pageParam }) =>
            exercisesApi.getAll(workspaceId, {
                search: search || undefined,
                includeArchived,
                page: pageParam,
                equipment: equipment === undefined ? undefined : equipment.join(','),
            }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
        enabled: Boolean(workspaceId),
    });
}

/** One exercise with its guide, images, and links. */
export function useExercise({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseQueryResult<ExerciseDetail & { webUrl: string }, Error> {
    return useQuery({
        queryKey: ['exercises', workspaceId, exerciseId],
        queryFn: () => exercisesApi.getById(workspaceId, exerciseId),
        enabled: Boolean(workspaceId && exerciseId),
    });
}

/** Gets recent completed appearances of an exercise for set prefills and in-workout reference. */
export function useExerciseHistory({
    workspaceId,
    exerciseId,
    limit,
}: {
    workspaceId: string;
    exerciseId: string;
    limit?: number;
}): UseQueryResult<ExerciseHistoryResponse, Error> {
    return useQuery({
        queryKey: ['exercises', workspaceId, exerciseId, 'history', limit ?? null],
        queryFn: () => exercisesApi.getHistory(workspaceId, exerciseId, limit),
        enabled: Boolean(workspaceId && exerciseId),
    });
}

/**
 * Gets what to open the next set with for an exercise, and the line explaining it.
 *
 * Fetched with the card rather than on the sparkle tap, so the suggestion is already in hand when
 * the user asks for it — a spinner between the tap and the numbers would defeat the point.
 */
export function useExerciseSuggestion({
    workspaceId,
    exerciseId,
    enabled = true,
}: {
    workspaceId: string;
    exerciseId: string;
    enabled?: boolean;
}): UseQueryResult<ExerciseSuggestion, Error> {
    return useQuery({
        queryKey: ['exercises', workspaceId, exerciseId, 'suggestion'],
        queryFn: () => exercisesApi.getSuggestion(workspaceId, exerciseId),
        enabled: enabled && Boolean(workspaceId && exerciseId),
    });
}

/** Creates an exercise and refreshes the list so it appears immediately. */
export function useCreateExercise({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<ExerciseDetail, Error, SaveExerciseRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: SaveExerciseRequest) => exercisesApi.create(workspaceId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/**
 * Updates an exercise and refreshes the list and its own detail query.
 *
 * A single invalidation by the `['exercises', workspaceId]` prefix covers both: react-query
 * matches by prefix, so `['exercises', workspaceId, exerciseId]` is already included.
 */
export function useUpdateExercise({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<ExerciseDetail, Error, { exerciseId: string; data: PatchExerciseRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ exerciseId, data }: { exerciseId: string; data: PatchExerciseRequest }) =>
            exercisesApi.update(workspaceId, exerciseId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/**
 * Saves the workspace's rest between sets for an exercise.
 *
 * Active sessions resolve their rest from this setting, so their queries are refreshed too — the
 * timer on the workout screen must follow a change made mid-session.
 */
export function useSetExercisePreferences({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<ExerciseDetail, Error, { exerciseId: string; data: SaveExercisePreferencesRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ exerciseId, data }: { exerciseId: string; data: SaveExercisePreferencesRequest }) =>
            exercisesApi.setPreferences({ workspaceId, exerciseId, data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
            queryClient.invalidateQueries({ queryKey: ['sessions', workspaceId] });
        },
    });
}

/** Adds an external link to an exercise's guide and refreshes its detail query. */
export function useAddExerciseLink({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseMutationResult<ExerciseLink, Error, SaveExerciseLinkRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: SaveExerciseLinkRequest) => exercisesApi.addLink({ workspaceId, exerciseId, data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/** Updates one of an exercise guide's links and refreshes its detail query. */
export function useUpdateExerciseLink({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseMutationResult<ExerciseLink, Error, { linkId: string; data: PatchExerciseLinkRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ linkId, data }: { linkId: string; data: PatchExerciseLinkRequest }) =>
            exercisesApi.updateLink({ workspaceId, exerciseId, linkId, data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/** Removes a link from an exercise's guide and refreshes its detail query. */
export function useRemoveExerciseLink({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (linkId: string) => exercisesApi.removeLink({ workspaceId, exerciseId, linkId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}
