import {
    guidSchema,
    putExercisePreferencesRequestSchema,
    type ExerciseDetailResponse,
    type PutExercisePreferencesRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExercisesService } from '@app/services';
import { Controller, Inject, Put, UseGuards } from '@nestjs/common';
import { CATALOG_IMAGE_BASE_URL } from '../providers.js';
import { EXERCISES_SERVICE } from './exercises.providers.js';
import { toDetailResponse } from './exercises.controller.js';

/** The workspace's own settings for an exercise. Session-only: no tool calls this. */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionAuthGuard)
export class ExercisePreferencesController {
    constructor(
        @Inject(EXERCISES_SERVICE) private readonly exercises: ExercisesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
        @Inject(CATALOG_IMAGE_BASE_URL) private readonly catalogImageBaseUrl: string,
    ) {}

    /** Sets the rest between sets for an exercise. Works for catalog exercises too. */
    @Put(':exerciseId/preferences')
    async putPreferences(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(putExercisePreferencesRequestSchema) body: PutExercisePreferencesRequest,
    ): Promise<ExerciseDetailResponse> {
        const updated = await this.exercises.setPreferences({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            restSeconds: body.restSeconds,
        });

        return toDetailResponse({
            exercise: updated,
            imageBaseUrl: this.catalogImageBaseUrl,
            workspaceId,
            urls: this.urls,
        });
    }
}
