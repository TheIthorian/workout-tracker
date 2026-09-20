import { guidSchema, type WorkspaceListItem, type WorkspaceResponse } from '@app/api-contract';
import { CurrentUser, SessionOrMcpBearerGuard, ValidatedParam, type CurrentUserContext } from '@app/nest-common';
import type { WorkspacesService } from '@app/services';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { WORKSPACES_SERVICE } from './workspaces.providers.js';

/**
 * Read-only access to the internal workspace scope.
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
    @UseGuards(SessionOrMcpBearerGuard)
    async listWorkspaces(@CurrentUser() currentUser: CurrentUserContext): Promise<WorkspaceListItem[]> {
        return this.workspaces.listForUser(currentUser.userId);
    }

    /** One workspace with its member list. */
    @Get(':workspaceId')
    @UseGuards(SessionOrMcpBearerGuard)
    async getWorkspace(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<WorkspaceResponse> {
        return this.workspaces.get({ userId: currentUser.userId, workspaceId });
    }
}
