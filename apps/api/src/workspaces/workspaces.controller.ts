import {
    guidSchema,
    patchWorkspaceRequestSchema,
    patchWorkspaceUserRoleRequestSchema,
    postWorkspaceRequestSchema,
    postWorkspaceUserRequestSchema,
    type MemberListItem,
    type PatchWorkspaceRequest,
    type PatchWorkspaceUserRoleRequest,
    type PostWorkspaceRequest,
    type PostWorkspaceUserRequest,
    type WorkspaceListItem,
    type WorkspaceResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    SessionOrMcpPatGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { WorkspacesService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { WORKSPACES_SERVICE } from './workspaces.providers.js';

/**
 * Workspaces and their membership.
 *
 * No class-level guard: `listWorkspaces` and `getWorkspace` are reachable by an MCP token as well
 * as a session, and Nest ANDs a class-level guard with any method-level one rather than letting the
 * method loosen it. Every route states its own guard.
 *
 * Authorisation lives in `WorkspacesService`, not here - it needs the caller's role, which is a
 * database read. A controller that pre-checked membership would either duplicate that query or
 * disagree with it.
 */
@Controller('v1/workspaces')
export class WorkspacesController {
    constructor(@Inject(WORKSPACES_SERVICE) private readonly workspaces: WorkspacesService) {}

    /** Every workspace the caller belongs to. */
    @Get()
    @UseGuards(SessionOrMcpPatGuard)
    async listWorkspaces(@CurrentUser() currentUser: CurrentUserContext): Promise<WorkspaceListItem[]> {
        return this.workspaces.listForUser(currentUser.userId);
    }

    /** Creates a workspace with the caller as its owner. Session-only: a token is pinned to one workspace. */
    @Post()
    @HttpCode(200)
    @UseGuards(SessionAuthGuard)
    async createWorkspace(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedBody(postWorkspaceRequestSchema) body: PostWorkspaceRequest,
    ): Promise<WorkspaceResponse> {
        return this.workspaces.create({ userId: currentUser.userId, name: body.name });
    }

    /** One workspace with its member list. */
    @Get(':workspaceId')
    @UseGuards(SessionOrMcpPatGuard)
    async getWorkspace(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<WorkspaceResponse> {
        return this.workspaces.get({ userId: currentUser.userId, workspaceId });
    }

    /** Renames a workspace. Requires the admin role or above. */
    @Patch(':workspaceId')
    @UseGuards(SessionAuthGuard)
    async patchWorkspace(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(patchWorkspaceRequestSchema) body: PatchWorkspaceRequest,
    ): Promise<WorkspaceResponse> {
        return this.workspaces.rename({ userId: currentUser.userId, workspaceId, name: body.name });
    }

    /** Deletes a workspace and everything in it. Requires the owner role. */
    @Delete(':workspaceId')
    @UseGuards(SessionAuthGuard)
    async deleteWorkspace(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<void> {
        await this.workspaces.remove({ userId: currentUser.userId, workspaceId });
    }

    /** Every member of the workspace. */
    @Get(':workspaceId/members')
    @UseGuards(SessionAuthGuard)
    async listMembers(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<MemberListItem[]> {
        return (await this.workspaces.get({ userId: currentUser.userId, workspaceId })).members;
    }

    /** Adds an existing user to the workspace by email. Requires the admin role or above. */
    @Post(':workspaceId/members')
    @HttpCode(200)
    @UseGuards(SessionAuthGuard)
    async addMember(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postWorkspaceUserRequestSchema) body: PostWorkspaceUserRequest,
    ): Promise<MemberListItem[]> {
        return this.workspaces.addMember({
            userId: currentUser.userId,
            workspaceId,
            email: body.email,
            role: body.role,
        });
    }

    /** Changes a member's role. Requires the admin role or above. */
    @Patch(':workspaceId/members/:memberUserId')
    @UseGuards(SessionAuthGuard)
    async updateMemberRole(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'memberUserId', schema: guidSchema }) memberUserId: string,
        @ValidatedBody(patchWorkspaceUserRoleRequestSchema) body: PatchWorkspaceUserRoleRequest,
    ): Promise<MemberListItem[]> {
        return this.workspaces.updateMemberRole({
            userId: currentUser.userId,
            workspaceId,
            memberUserId,
            role: body.role,
        });
    }

    /** Removes a member. Requires the admin role or above. */
    @Delete(':workspaceId/members/:memberUserId')
    @UseGuards(SessionAuthGuard)
    async removeMember(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'memberUserId', schema: guidSchema }) memberUserId: string,
    ): Promise<void> {
        await this.workspaces.removeMember({ userId: currentUser.userId, workspaceId, memberUserId });
    }
}
