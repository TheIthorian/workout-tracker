import {
    exerciseHistoryQuerySchema,
    guidSchema,
    type ExerciseHistoryQuery,
    type ExerciseHistoryResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseHistoryService } from '@app/services';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { EXERCISE_HISTORY_SERVICE } from './exercises.providers.js';

/** Browser-session-only completed workout history for an exercise. */
@Controller('v1/workspaces/:workspaceId/exercises/:exerciseId/history')
@UseGuards(SessionAuthGuard)
export class ExerciseHistoryController {
    constructor(@Inject(EXERCISE_HISTORY_SERVICE) private readonly history: ExerciseHistoryService) {}

    /** Returns completed appearances of an exercise. */
    @Get()
    async getHistory(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedQuery(exerciseHistoryQuerySchema) query: ExerciseHistoryQuery,
    ): Promise<ExerciseHistoryResponse> {
        return this.history.recent({ userId: user.userId, workspaceId, exerciseId, limit: query.limit });
    }
}
