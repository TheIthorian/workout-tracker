/** Ordered least to most privileged. Mirrors the `workspace_role` enum the API stores. */
export enum WorkspaceRole {
    Member = 'member',
    Admin = 'admin',
    Owner = 'owner',
}

/** A workspace as it appears nested inside {@link UserResponse}. */
export type WorkspaceListItem = {
    workspaceId: string;
    name: string;
    role: WorkspaceRole;
    onboardingStage: OnboardingStage;
};

/** One member of a workspace. */
export type MemberListItem = {
    userId: string;
    displayName: string;
    email: string;
    role: WorkspaceRole;
};

/** A single workspace with its full member list. */
export type WorkspaceResponse = {
    workspaceId: string;
    name: string;
    role: WorkspaceRole;
    members: MemberListItem[];
};
import type { OnboardingStage } from './equipment';
