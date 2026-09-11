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
    ExerciseGuideImage,
    ExerciseLink,
    PatchExerciseLinkRequest,
    PatchExerciseRequest,
    SaveExerciseLinkRequest,
    SaveExerciseRequest,
} from '@/models/exercise';
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
        mutationFn: (data: SaveExerciseLinkRequest) => exercisesApi.addLink(workspaceId, exerciseId, data),
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
            exercisesApi.updateLink(workspaceId, exerciseId, linkId, data),
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
        mutationFn: (linkId: string) => exercisesApi.removeLink(workspaceId, exerciseId, linkId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/** Uploads a guide image (as multipart form data) and refreshes the exercise's detail query. */
export function useUploadExerciseImage({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseMutationResult<ExerciseGuideImage, Error, FormData> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (formData: FormData) => exercisesApi.uploadImage(workspaceId, exerciseId, formData),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}

/** Removes a guide image and refreshes the exercise's detail query. */
export function useRemoveExerciseImage({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (imageId: string) => exercisesApi.removeImage(workspaceId, exerciseId, imageId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
        },
    });
}
