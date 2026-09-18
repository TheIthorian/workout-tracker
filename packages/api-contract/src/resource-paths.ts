/**
 * Where each resource lives, as paths - one in the web app, one on this API. Kept beside the
 * schemas rather than inside `ResourceUrlGenerator` (`@app/nest-common`), which is deliberately
 * resource-agnostic: it turns a path into an absolute url and knows nothing about a resource's domain model.
 *
 * Both apps import these, so a resource linked from an MCP tool result and one linked from a REST
 * response point at the same place. The API paths are written WITHOUT the `/api/v1` prefix - the
 * generator adds it, because that prefix belongs to the API as a whole.
 */

/** The exercise's page in the SPA. */
export function exerciseWebPath({ exerciseId }: { exerciseId: string }): string {
    return `/exercises/${exerciseId}`;
}

/** The exercise's own REST route, without the `/api/v1` prefix the generator adds. */
export function exerciseApiPath({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}`;
}

/** An exercise's next-time target, without the `/api/v1` prefix the generator adds. */
export function exerciseTargetApiPath({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): string {
    return `${exerciseApiPath({ workspaceId, exerciseId })}/target`;
}

/** An exercise's suggested next effort, without the `/api/v1` prefix the generator adds. */
export function exerciseSuggestionApiPath({
    workspaceId,
    exerciseId,
}: {
    workspaceId: string;
    exerciseId: string;
}): string {
    return `${exerciseApiPath({ workspaceId, exerciseId })}/suggestion`;
}

/** The routine's editor page in the SPA. */
export function routineWebPath({ routineId }: { routineId: string }): string {
    return `/routines/${routineId}`;
}

/** The routine's own REST route, without the `/api/v1` prefix the generator adds. */
export function routineApiPath({ workspaceId, routineId }: { workspaceId: string; routineId: string }): string {
    return `/workspaces/${workspaceId}/routines/${routineId}`;
}

/** The session page in the SPA. */
export function sessionWebPath({ sessionId }: { sessionId: string }): string {
    return `/sessions/${sessionId}`;
}

/** The session REST path without the API version prefix. */
export function sessionApiPath({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }): string {
    return `/workspaces/${workspaceId}/sessions/${sessionId}`;
}
