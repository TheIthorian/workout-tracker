/** The path this server's MCP endpoint is mounted at, and the path component of its resource id. */
export const MCP_RESOURCE_PATH = '/mcp';

/**
 * The `WWW-Authenticate` value a rejected MCP request carries.
 *
 * `resource_metadata` is the whole point: RFC 9728 §5.1 makes it how a client that has never seen
 * this server discovers which authorization server to go to, so a 401 without it leaves the client
 * with nowhere to go and no way to recover.
 */
export function buildWwwAuthenticate({
    resourceMetadataUrl,
    error,
    description,
}: {
    resourceMetadataUrl: string;
    error: string;
    description: string;
}): string {
    return `Bearer error="${error}", error_description="${escapeQuoted(description)}", resource_metadata="${resourceMetadataUrl}"`;
}

/** Keeps a description from terminating the quoted string it is embedded in. */
function escapeQuoted(value: string): string {
    return value.replace(/["\\]/g, '');
}
