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
