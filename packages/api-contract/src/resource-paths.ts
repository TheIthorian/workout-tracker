/**
 * Where each resource lives, as paths - one in the web app, one on this API. Kept beside the
 * schemas rather than inside `ResourceUrlGenerator` (`@app/nest-common`), which is deliberately
 * resource-agnostic: it turns a path into an absolute url and knows nothing about items.
 *
 * Both apps import these, so a resource linked from an MCP tool result and one linked from a REST
 * response point at the same place. The API paths are written WITHOUT the `/api/v1` prefix - the
 * generator adds it, because that prefix belongs to the API as a whole.
 */

/** The item's page in the SPA. */
export function itemWebPath({ workspaceId, itemId }: { workspaceId: string; itemId: string }): string {
    return `/workspaces/${workspaceId}/items/${itemId}`;
}

/** The item's own REST route. */
export function itemApiPath({ workspaceId, itemId }: { workspaceId: string; itemId: string }): string {
    return `/workspaces/${workspaceId}/items/${itemId}`;
}

/** The exercise's page in the SPA. */
export function exerciseWebPath({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}`;
}

/** The exercise's own REST route, without the `/api/v1` prefix the generator adds. */
export function exerciseApiPath({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}`;
}

/** The API route that streams an exercise guide image's bytes, without the `/api/v1` prefix. */
export function exerciseImageContentPath({
    workspaceId,
    exerciseId,
    imageId,
}: {
    workspaceId: string;
    exerciseId: string;
    imageId: string;
}): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}/images/${imageId}/content`;
}
