import {
    exerciseListQuerySchema,
    exerciseWebPath,
    guidSchema,
    patchExerciseRequestSchema,
    postExerciseRequestSchema,
    type ExerciseDetailResponse,
    type ExerciseListQuery,
    type ExerciseListResponse,
    type PatchExerciseRequest,
    type PostExerciseRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionOrMcpPatGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseDetail, ExercisesService } from '@app/services';
import { Controller, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { CATALOG_IMAGE_BASE_URL } from '../providers.js';
import { EXERCISES_SERVICE } from './exercises.providers.js';

/** The exercise library a workspace sees: the shared catalog and its own custom exercises. */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionOrMcpPatGuard)
export class ExercisesController {
    constructor(
        @Inject(EXERCISES_SERVICE) private readonly exercises: ExercisesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
        @Inject(CATALOG_IMAGE_BASE_URL) private readonly catalogImageBaseUrl: string,
    ) {}

    /** A page of the workspace's exercises, by name. */
    @Get()
    async listExercises(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(exerciseListQuerySchema) query: ExerciseListQuery,
    ): Promise<ExerciseListResponse> {
        return this.exercises.list({
            userId: currentUser.userId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize,
            search: query.search,
            includeArchived: query.includeArchived,
        });
    }

    /** One exercise with its guide, images, and links, plus the link to its page in the web app. */
    @Get(':exerciseId')
    async getExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
    ): Promise<ExerciseDetailResponse & { webUrl: string }> {
        const exercise = await this.exercises.get({ userId: currentUser.userId, workspaceId, exerciseId });

        return {
            ...toDetailResponse({ exercise, imageBaseUrl: this.catalogImageBaseUrl, workspaceId, urls: this.urls }),
            webUrl: this.urls.webAppUrl({ path: exerciseWebPath({ exerciseId }) }),
        };
    }

    /** Creates an exercise in the workspace. */
    @Post()
    @HttpCode(200)
    async createExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postExerciseRequestSchema) body: PostExerciseRequest,
    ): Promise<ExerciseDetailResponse> {
        const created = await this.exercises.create({ userId: currentUser.userId, workspaceId, ...body });

        return toDetailResponse({
            exercise: created,
            imageBaseUrl: this.catalogImageBaseUrl,
            workspaceId,
            urls: this.urls,
        });
    }

    /** Updates an exercise. An omitted key leaves the stored value alone. */
    @Patch(':exerciseId')
    async patchExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(patchExerciseRequestSchema) body: PatchExerciseRequest,
    ): Promise<ExerciseDetailResponse> {
        const updated = await this.exercises.update({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            ...body,
        });

        return toDetailResponse({
            exercise: updated,
            imageBaseUrl: this.catalogImageBaseUrl,
            workspaceId,
            urls: this.urls,
        });
    }
}

/**
 * Storage keys become absolute CDN urls here, and only here: the service returns keys because the
 * base origin is deployment configuration, which belongs to the app.
 */
function toDetailResponse({
    exercise,
    imageBaseUrl,
    workspaceId,
    urls,
}: {
    exercise: ExerciseDetail;
    imageBaseUrl: string;
    workspaceId: string;
    urls: ResourceUrlGenerator;
}): ExerciseDetailResponse {
    return {
        ...exercise,
        images: exercise.images.map((image) => ({
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: exercise.isCatalog
                ? `${imageBaseUrl}/${image.storageKey}`
                : urls.webAppUrl({
                      path: `/api/v1/workspaces/${workspaceId}/exercises/${exercise.id}/images/${image.id}`,
                  }),
        })),
    };
}
