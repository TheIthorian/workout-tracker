import {
    guidSchema,
    patchExerciseLinkRequestSchema,
    postExerciseLinkRequestSchema,
    type ExerciseLinkResponse,
    type PatchExerciseLinkRequest,
    type PostExerciseLinkRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    SessionOrMcpBearerGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseGuideService } from '@app/services';
import { Controller, Delete, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { EXERCISE_GUIDE_SERVICE } from './exercises.providers.js';

/**
 * An exercise guide's external links.
 *
 * No class-level guard, matching `WorkspacesController`'s precedent: `createLink` is the one route
 * `AddExerciseLink` actually calls, so it alone carries `SessionOrMcpBearerGuard`. There is no
 * `UpdateExerciseLink`/`RemoveExerciseLink` tool, so `patchLink` and `deleteLink` stay
 * session-only - a route gets token reachability only when a tool genuinely needs it, per
 * `route-guard-coverage.e2e.spec.ts`.
 */
@Controller('v1/workspaces/:workspaceId/exercises')
export class ExerciseGuideController {
    constructor(@Inject(EXERCISE_GUIDE_SERVICE) private readonly guides: ExerciseGuideService) {}

    /** Appends an external link to the exercise's guide. Reachable by an MCP token: `AddExerciseLink`. */
    @Post(':exerciseId/links')
    @HttpCode(200)
    @UseGuards(SessionOrMcpBearerGuard)
    async createLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(postExerciseLinkRequestSchema) body: PostExerciseLinkRequest,
    ): Promise<ExerciseLinkResponse> {
        return this.guides.addLink({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            url: body.url,
            label: body.label ?? null,
        });
    }

    /** Updates a link. An omitted key leaves the stored value alone. Session-only: no tool calls this. */
    @Patch(':exerciseId/links/:linkId')
    @UseGuards(SessionAuthGuard)
    async patchLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
        @ValidatedBody(patchExerciseLinkRequestSchema) body: PatchExerciseLinkRequest,
    ): Promise<ExerciseLinkResponse> {
        return this.guides.updateLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId, ...body });
    }

    /** Deletes a link from the exercise's guide. Session-only: no tool calls this. */
    @Delete(':exerciseId/links/:linkId')
    @UseGuards(SessionAuthGuard)
    async deleteLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
    ): Promise<void> {
        await this.guides.removeLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId });
    }
}
