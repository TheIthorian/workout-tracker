export type McpAccessTokenCreated = {
    id: string;
    workspaceId: string;
    /** The plaintext token, returned exactly once at creation and unrecoverable afterwards. */
    token: string;
    mcpUrl: string;
};

export type McpAccessTokenListItem = {
    id: string;
    workspaceId: string;
    name: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
};
