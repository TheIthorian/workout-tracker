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
import { routinesApi } from '@/lib/api';
import type { PaginatedResponse } from '@/models/pagination';
import type {
    PatchRoutineExerciseRequest,
    PatchRoutineRequest,
    RoutineDetail,
    RoutineListItem,
    RoutineOrder,
    SaveRoutineExerciseRequest,
    SaveRoutineRequest,
} from '@/models/routine';

/**
 * The user's routines, optionally filtered by name, one page at a time, by name unless `sort` says
 * otherwise. `search` is assumed trimmed.
 */
export function useRoutines({
    workspaceId,
    search,
    sort,
}: {
    workspaceId: string;
    search?: string;
    sort?: RoutineOrder;
}): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<RoutineListItem>>, Error> {
    return useInfiniteQuery({
        queryKey: ['routines', workspaceId, { search: search ?? '', sort: sort ?? null }],
        queryFn: ({ pageParam }) =>
            routinesApi.getAll(workspaceId, { search: search || undefined, sort, page: pageParam }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
        enabled: Boolean(workspaceId),
    });
}

/** One routine with its ordered slots. */
export function useRoutine({
    workspaceId,
    routineId,
}: {
    workspaceId: string;
    routineId: string;
}): UseQueryResult<RoutineDetail & { webUrl: string }, Error> {
    return useQuery({
        queryKey: ['routines', workspaceId, routineId],
        queryFn: () => routinesApi.getById(workspaceId, routineId),
        enabled: Boolean(workspaceId && routineId),
    });
}

/** Creates a routine and refreshes the list. */
export function useCreateRoutine({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<RoutineDetail, Error, SaveRoutineRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: SaveRoutineRequest) => routinesApi.create(workspaceId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['routines', workspaceId] });
        },
    });
}

/** Updates a routine's own fields. One prefix invalidation covers the list and the detail query. */
export function useUpdateRoutine({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<RoutineDetail, Error, { routineId: string; data: PatchRoutineRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ routineId, data }: { routineId: string; data: PatchRoutineRequest }) =>
            routinesApi.update(workspaceId, routineId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['routines', workspaceId] });
        },
    });
}

/** Appends a slot to the routine. */
export function useAddRoutineExercise({
    workspaceId,
    routineId,
}: {
    workspaceId: string;
    routineId: string;
}): UseMutationResult<RoutineDetail, Error, SaveRoutineExerciseRequest> {
    return useRoutineSlotMutation({
        workspaceId,
        routineId,
        mutationFn: (data: SaveRoutineExerciseRequest) => routinesApi.addExercise({ workspaceId, routineId, data }),
    });
}

/** Updates one slot's targets. */
export function useUpdateRoutineExercise({
    workspaceId,
    routineId,
}: {
    workspaceId: string;
    routineId: string;
}): UseMutationResult<RoutineDetail, Error, { routineExerciseId: string; data: PatchRoutineExerciseRequest }> {
    return useRoutineSlotMutation({
        workspaceId,
        routineId,
        mutationFn: ({ routineExerciseId, data }: { routineExerciseId: string; data: PatchRoutineExerciseRequest }) =>
            routinesApi.updateExercise({ workspaceId, routineId, routineExerciseId, data }),
    });
}

/** Removes a slot. */
export function useRemoveRoutineExercise({
    workspaceId,
    routineId,
}: {
    workspaceId: string;
    routineId: string;
}): UseMutationResult<RoutineDetail, Error, string> {
    return useRoutineSlotMutation({
        workspaceId,
        routineId,
        mutationFn: (routineExerciseId: string) =>
            routinesApi.removeExercise({ workspaceId, routineId, routineExerciseId }),
    });
}

/** Replaces the whole slot list — how the editor commits a drag-reorder. */
export function useReplaceRoutineExercises({
    workspaceId,
    routineId,
}: {
    workspaceId: string;
    routineId: string;
}): UseMutationResult<RoutineDetail, Error, SaveRoutineExerciseRequest[]> {
    return useRoutineSlotMutation({
        workspaceId,
        routineId,
        mutationFn: (exercises: SaveRoutineExerciseRequest[]) =>
            routinesApi.replaceExercises({ workspaceId, routineId, exercises }),
    });
}

/**
 * The slot mutations all resolve to the whole routine, so each one writes that straight into the
 * detail query (no refetch flash) and then invalidates the list for its `exerciseCount`.
 */
function useRoutineSlotMutation<TVariables>({
    workspaceId,
    routineId,
    mutationFn,
}: {
    workspaceId: string;
    routineId: string;
    mutationFn: (variables: TVariables) => Promise<RoutineDetail>;
}): UseMutationResult<RoutineDetail, Error, TVariables> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onSuccess: (routine) => {
            queryClient.setQueryData<RoutineDetail & { webUrl: string }>(
                ['routines', workspaceId, routineId],
                (previous) => (previous ? { ...previous, ...routine } : previous),
            );
            // Only the list queries (their third key element is the `{ search, sort }` object): the
            // detail query was just written above and must not be refetched over.
            queryClient.invalidateQueries({
                queryKey: ['routines', workspaceId],
                predicate: (query) => query.queryKey.length === 3 && typeof query.queryKey[2] === 'object',
            });
        },
        onError: () => {
            queryClient.invalidateQueries({ queryKey: ['routines', workspaceId, routineId] });
        },
    });
}
