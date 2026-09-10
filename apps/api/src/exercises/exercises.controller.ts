import {
    exerciseImageContentPath,
    exerciseWebPath,
    guidSchema,
    paginationQuerySchema,
    patchExerciseRequestSchema,
    postExerciseRequestSchema,
    type ExerciseDetailResponse,
    type ExerciseListResponse,
    type PaginationQuery,
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
import { z } from 'zod';
import { EXERCISES_SERVICE } from './exercises.providers.js';

const exerciseListQuerySchema = paginationQuerySchema.extend({
    search: z.string().max(200).optional(),
    includeArchived: z
        .unknown()
        .optional()
        .transform((raw) => String(raw ?? '').toLowerCase() === 'true')
        .pipe(z.boolean()),
});

type ExerciseListQuery = PaginationQuery & { search?: string; includeArchived: boolean };

/** The workspace's exercise library and each exercise's guide. */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionOrMcpPatGuard)
export class ExercisesController {
    constructor(
        @Inject(EXERCISES_SERVICE) private readonly exercises: ExercisesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** A page of the workspace's exercises, newest first. */
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
            ...toDetailResponse({ exercise, workspaceId, urls: this.urls }),
            webUrl: this.urls.webAppUrl({ path: exerciseWebPath({ workspaceId, exerciseId }) }),
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

        return toDetailResponse({ exercise: created, workspaceId, urls: this.urls });
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

        return toDetailResponse({ exercise: updated, workspaceId, urls: this.urls });
    }
}

/**
 * Storage keys never reach the wire: each image is addressed by the guarded content route that
 * streams its bytes (`ExerciseGuideController.getImageContent`).
 */
function toDetailResponse({
    exercise,
    workspaceId,
    urls,
}: {
    exercise: ExerciseDetail;
    workspaceId: string;
    urls: ResourceUrlGenerator;
}): ExerciseDetailResponse {
    return {
        ...exercise,
        images: exercise.images.map((image) => ({
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: urls.apiUrl({
                path: exerciseImageContentPath({ workspaceId, exerciseId: exercise.id, imageId: image.id }),
            }),
        })),
    };
}
