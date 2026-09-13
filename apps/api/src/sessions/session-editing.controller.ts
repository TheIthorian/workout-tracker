import {
    guidSchema,
    patchSessionExerciseRequestSchema,
    patchSetRequestSchema,
    postSessionExerciseRequestSchema,
    putSessionExerciseOrderRequestSchema,
    type PatchSessionExerciseRequest,
    type PatchSetRequest,
    type PostSessionExerciseRequest,
    type PutSessionExerciseOrderRequest,
    type SessionDetailResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { WorkoutSessionsService } from '@app/services';
import { Controller, Delete, HttpCode, Inject, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { WORKOUT_SESSIONS_SERVICE } from './sessions.providers.js';

/** Browser-session-only structural editing and correction routes. */
@Controller('v1/workspaces/:workspaceId/sessions/:sessionId')
@UseGuards(SessionAuthGuard)
export class SessionEditingController {
    constructor(@Inject(WORKOUT_SESSIONS_SERVICE) private readonly sessions: WorkoutSessionsService) {}
    /** Abandons an active session. */
    @Delete()
    @HttpCode(204)
    async abandon(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
    ): Promise<void> {
        return this.sessions.abandon({ userId: user.userId, workspaceId, sessionId });
    }
    /** Adds an ad-hoc exercise. */
    @Post('exercises')
    @HttpCode(200)
    async addExercise(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(postSessionExerciseRequestSchema) body: PostSessionExerciseRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.addExercise({ userId: user.userId, workspaceId, sessionId, ...body });
    }
    /** Edits session exercise targets or its skipped state. */
    @Patch('exercises/:sessionExerciseId')
    async patchExercise(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedBody(patchSessionExerciseRequestSchema) body: PatchSessionExerciseRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.updateExercise({
            userId: user.userId,
            workspaceId,
            sessionId,
            sessionExerciseId,
            ...body,
        });
    }
    /** Reorders session exercises. */
    @Put('exercises/order')
    async reorder(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(putSessionExerciseOrderRequestSchema) body: PutSessionExerciseOrderRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.reorderExercises({ userId: user.userId, workspaceId, sessionId, ...body });
    }
    /** Corrects a logged set. */
    @Patch('exercises/:sessionExerciseId/sets/:setId')
    async patchSet(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedParam({ name: 'setId', schema: guidSchema }) setId: string,
        @ValidatedBody(patchSetRequestSchema) body: PatchSetRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.updateSet({
            userId: user.userId,
            workspaceId,
            sessionId,
            sessionExerciseId,
            setId,
            ...body,
        });
    }
    /** Deletes a logged set. */
    @Delete('exercises/:sessionExerciseId/sets/:setId')
    async deleteSet(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedParam({ name: 'setId', schema: guidSchema }) setId: string,
    ): Promise<SessionDetailResponse> {
        return this.sessions.deleteSet({ userId: user.userId, workspaceId, sessionId, sessionExerciseId, setId });
    }
}
