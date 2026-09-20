import {
    guidSchema,
    putExerciseTargetRequestSchema,
    type ExerciseSuggestionResponse,
    type ExerciseTargetResponse,
    type PutExerciseTargetRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionOrMcpBearerGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseTargetsService } from '@app/services';
import { Controller, Delete, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { EXERCISE_TARGETS_SERVICE } from './exercises.providers.js';

/**
 * What to aim for next time on an exercise: the target the user or their coaching agent set, and
 * the suggestion built from it and the exercise's own history.
 *
 * Every route here carries `SessionOrMcpBearerGuard` because setting a target is exactly what an agent
 * is for — the app and the coach write to the same place, and the app reads back whatever is there.
 */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionOrMcpBearerGuard)
export class ExerciseTargetsController {
    constructor(@Inject(EXERCISE_TARGETS_SERVICE) private readonly targets: ExerciseTargetsService) {}

    /** Returns what to open the next session with, and why. */
    @Get(':exerciseId/suggestion')
    async getSuggestion(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
    ): Promise<ExerciseSuggestionResponse> {
        return this.targets.suggest({ userId: currentUser.userId, workspaceId, exerciseId });
    }

    /** Replaces the target for the next session. */
    @Put(':exerciseId/target')
    async putTarget(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(putExerciseTargetRequestSchema) body: PutExerciseTargetRequest,
    ): Promise<ExerciseTargetResponse> {
        return this.targets.set({ userId: currentUser.userId, workspaceId, exerciseId, ...body });
    }

    /** Removes the target, leaving the suggestion to come from history alone. */
    @Delete(':exerciseId/target')
    async deleteTarget(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
    ): Promise<void> {
        await this.targets.clear({ userId: currentUser.userId, workspaceId, exerciseId });
    }
}
