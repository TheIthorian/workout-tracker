import { OnboardingStage } from '@app/domain';
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
    onboardingStage: z.enum(OnboardingStage),
});

/** The body of `GET /api/v1/workspaces/{workspaceId}`. */
export const workspaceResponseSchema = z.object({
    workspaceId: guidSchema,
    name: z.string(),
    role: z.enum(WorkspaceRole),
    members: z.array(memberListItemSchema),
});

export type MemberListItem = z.infer<typeof memberListItemSchema>;
export type WorkspaceListItem = z.infer<typeof workspaceListItemSchema>;
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
