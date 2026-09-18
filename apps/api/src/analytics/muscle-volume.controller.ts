import {
    guidSchema,
    muscleVolumeQuerySchema,
    type MuscleVolumeQuery,
    type MuscleVolumeResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { MuscleVolumeService } from '@app/services';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { MUSCLE_VOLUME_SERVICE } from './analytics.providers.js';

/** Training volume per muscle over a recent window — what the web app's body heatmap reads. */
@Controller('v1/workspaces/:workspaceId/analytics/muscle-volume')
@UseGuards(SessionAuthGuard)
export class MuscleVolumeController {
    constructor(@Inject(MUSCLE_VOLUME_SERVICE) private readonly muscleVolume: MuscleVolumeService) {}

    /** Summarises completed workouts in the window by muscle and by exercise. */
    @Get()
    async getMuscleVolume(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(muscleVolumeQuerySchema) query: MuscleVolumeQuery,
    ): Promise<MuscleVolumeResponse> {
        return this.muscleVolume.summarise({ userId: user.userId, workspaceId, days: query.days });
    }
}
