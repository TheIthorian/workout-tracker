import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api';
import type { MuscleVolumeResponse } from '@/models/muscle';

/** Per-muscle training volume over the last `days` days of completed workouts. */
export function useMuscleVolume({
    workspaceId,
    days,
}: {
    workspaceId: string;
    days: number;
}): UseQueryResult<MuscleVolumeResponse, Error> {
    return useQuery({
        queryKey: ['muscle-volume', workspaceId, days],
        queryFn: () => analyticsApi.getMuscleVolume({ workspaceId, days }),
        enabled: Boolean(workspaceId),
    });
}
