import { exerciseApiPath, exerciseWebPath } from '@app/api-contract';
import type { ResourceUrlGenerator, WithResourceUrls } from '@app/nest-common';

/**
 * Attaches an exercise's two links to a tool result, from the same path definitions `apps/api`
 * uses - what makes an exercise reached through a tool carry the identical urls to one reached over
 * REST. `ResourceUrlGenerator` itself is resource-agnostic and knows nothing about exercises.
 */
export function attachExerciseLinks<T extends { id: string }>({
    urls,
    exercise,
    workspaceId,
}: {
    urls: ResourceUrlGenerator;
    exercise: T;
    workspaceId: string;
}): WithResourceUrls<T> {
    return urls.attach({
        resource: exercise,
        webPath: exerciseWebPath({ workspaceId, exerciseId: exercise.id }),
        apiPath: exerciseApiPath({ workspaceId, exerciseId: exercise.id }),
    });
}
