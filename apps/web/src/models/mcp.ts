/** An MCP client the signed-in user has connected through the OAuth flow. */
export type ConnectedApp = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    scopes: string[];
    connectedAt: string;
    lastUsedAt: string | null;
};

/** The URL a user pastes into an MCP client to start the flow. Carries no credential. */
export type McpConnection = {
    mcpUrl: string;
};

/** What the consent screen renders about a pending authorization request. */
export type OAuthConsentRequest = {
    requestId: string;
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    tosUri: string | null;
    policyUri: string | null;
    /** The hosts approving would send the browser to — the part a user can actually check. */
    redirectHosts: string[];
    scopes: string[];
    previouslyApproved: boolean;
};

export type OAuthConsentDecision = 'approve' | 'deny';
