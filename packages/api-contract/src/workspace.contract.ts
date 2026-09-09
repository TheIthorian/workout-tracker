import { z } from 'zod';
import { guidSchema } from './primitives.js';

/**
 * A member's role within one workspace, ordered least to most privileged. Mirrors the
 * `workspace_role` Postgres enum in `@app/db` and `WorkspaceRole` in `@app/services`; all three
 * must stay in step.
 */
export enum WorkspaceRole {
    Member = 'member',
    Admin = 'admin',
    Owner = 'owner',
}

/** A member of a workspace, as returned inside `WorkspaceResponse`. */
export const memberListItemSchema = z.object({
    userId: guidSchema,
    displayName: z.string(),
    email: z.string(),
    role: z.enum(WorkspaceRole),
});

/** A workspace as it appears nested inside `UserResponse`. */
export const workspaceListItemSchema = z.object({
    workspaceId: guidSchema,
    name: z.string(),
    role: z.enum(WorkspaceRole),
});

/** The body of `GET /api/v1/workspaces/{workspaceId}`. */
export const workspaceResponseSchema = z.object({
    workspaceId: guidSchema,
    name: z.string(),
    role: z.enum(WorkspaceRole),
    members: z.array(memberListItemSchema),
});

/** The body of `POST /api/v1/workspaces`. */
export const postWorkspaceRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}`. */
export const patchWorkspaceRequestSchema = postWorkspaceRequestSchema;

/** The body of `POST /api/v1/workspaces/{workspaceId}/members`. */
export const postWorkspaceUserRequestSchema = z.object({
    email: z.email(),
    role: z.enum(WorkspaceRole).default(WorkspaceRole.Member),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/members/{userId}`. */
export const patchWorkspaceUserRoleRequestSchema = z.object({
    role: z.enum(WorkspaceRole),
});

export type MemberListItem = z.infer<typeof memberListItemSchema>;
export type WorkspaceListItem = z.infer<typeof workspaceListItemSchema>;
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
export type PostWorkspaceRequest = z.infer<typeof postWorkspaceRequestSchema>;
export type PatchWorkspaceRequest = z.infer<typeof patchWorkspaceRequestSchema>;
export type PostWorkspaceUserRequest = z.infer<typeof postWorkspaceUserRequestSchema>;
export type PatchWorkspaceUserRoleRequest = z.infer<typeof patchWorkspaceUserRoleRequestSchema>;
