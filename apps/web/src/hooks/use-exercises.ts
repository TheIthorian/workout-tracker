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
import type { Exercise, ExerciseDetail, PatchExerciseRequest, SaveExerciseRequest } from '@/models/exercise';
import type { PaginatedResponse } from '@/models/pagination';

/**
 * The workspace's exercise library, optionally filtered by name, one page at a time.
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
}: {
    workspaceId: string;
    search?: string;
}): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Exercise>>, Error> {
    return useInfiniteQuery({
        queryKey: ['exercises', workspaceId, { search: search ?? '' }],
        queryFn: ({ pageParam }) => exercisesApi.getAll(workspaceId, { search: search || undefined, page: pageParam }),
        initialPageParam: 1,
        getNextPageParam: lastPage => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
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

/** Creates an exercise in the workspace and refreshes the list so it appears immediately. */
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
