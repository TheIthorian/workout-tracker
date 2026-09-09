import { z } from 'zod';
import { guidSchema } from './primitives.js';

/** The body of `POST /api/v1/me/mcp-access-tokens`. A token is pinned to one workspace. */
export const postMcpAccessTokenRequestSchema = z.object({
    workspaceId: guidSchema,
    name: z.string().max(128).optional().nullable(),
});

/** `token` is the only time the plaintext is ever returned. */
export const mcpAccessTokenCreatedResponseSchema = z.object({
    id: guidSchema,
    workspaceId: guidSchema,
    token: z.string(),
    mcpUrl: z.string(),
});

/** Timestamps are ISO-8601 strings. */
export const mcpAccessTokenListItemResponseSchema = z.object({
    id: guidSchema,
    workspaceId: guidSchema,
    name: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
});

export type PostMcpAccessTokenRequest = z.infer<typeof postMcpAccessTokenRequestSchema>;
export type McpAccessTokenCreatedResponse = z.infer<typeof mcpAccessTokenCreatedResponseSchema>;
export type McpAccessTokenListItemResponse = z.infer<typeof mcpAccessTokenListItemResponseSchema>;
