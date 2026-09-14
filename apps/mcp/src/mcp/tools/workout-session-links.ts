import { sessionApiPath, sessionWebPath } from '@app/api-contract';
import type { ResourceUrlGenerator, WithResourceUrls } from '@app/nest-common';

/** Attaches canonical web and API links to a workout session result. */
export function attachWorkoutSessionLinks<T extends { id: string }>({
    urls,
    session,
    workspaceId,
}: {
    urls: ResourceUrlGenerator;
    session: T;
    workspaceId: string;
}): WithResourceUrls<T> {
    return urls.attach({
        resource: session,
        webPath: sessionWebPath({ sessionId: session.id }),
        apiPath: sessionApiPath({ workspaceId, sessionId: session.id }),
    });
}
