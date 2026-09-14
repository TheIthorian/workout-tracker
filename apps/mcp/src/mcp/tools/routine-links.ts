import { routineApiPath, routineWebPath } from '@app/api-contract';
import type { ResourceUrlGenerator, WithResourceUrls } from '@app/nest-common';

/**
 * Attaches a routine's two links to a tool result, from the same path definitions `apps/api` uses,
 * so a routine reached through a tool carries the identical urls to one reached over REST.
 */
export function attachRoutineLinks<T extends { id: string }>({
    urls,
    routine,
    workspaceId,
}: {
    urls: ResourceUrlGenerator;
    routine: T;
    workspaceId: string;
}): WithResourceUrls<T> {
    return urls.attach({
        resource: routine,
        webPath: routineWebPath({ routineId: routine.id }),
        apiPath: routineApiPath({ workspaceId, routineId: routine.id }),
    });
}
