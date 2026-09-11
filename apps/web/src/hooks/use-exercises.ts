import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from '@tanstack/react-query';
import { exercisesApi } from '@/lib/api';
import type { Exercise, ExerciseDetail, PatchExerciseRequest, SaveExerciseRequest } from '@/models/exercise';
import type { PaginatedResponse } from '@/models/pagination';

/** The workspace's exercise library, optionally filtered by name. */
export function useExercises({
    workspaceId,
    search,
}: {
    workspaceId: string;
    search?: string;
}): UseQueryResult<PaginatedResponse<Exercise>, Error> {
    return useQuery({
        queryKey: ['exercises', workspaceId, { search: search ?? '' }],
        queryFn: () => exercisesApi.getAll(workspaceId, { search: search || undefined }),
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

/** Updates an exercise and refreshes both the list and its own detail query. */
export function useUpdateExercise({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<ExerciseDetail, Error, { exerciseId: string; data: PatchExerciseRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ exerciseId, data }: { exerciseId: string; data: PatchExerciseRequest }) =>
            exercisesApi.update(workspaceId, exerciseId, data),
        onSuccess: (_updated, variables) => {
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId] });
            queryClient.invalidateQueries({ queryKey: ['exercises', workspaceId, variables.exerciseId] });
        },
    });
}
