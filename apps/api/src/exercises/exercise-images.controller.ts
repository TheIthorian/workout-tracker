import {
    guidSchema,
    MAX_EXERCISE_IMAGE_BYTES,
    patchExerciseImageRequestSchema,
    postExerciseImageQuerySchema,
    type ExerciseGuideImageResponse,
    type PatchExerciseImageRequest,
    type PostExerciseImageQuery,
} from '@app/api-contract';
import { InvalidFormatError } from '@app/errors';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseImagesService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EXERCISE_IMAGES_SERVICE } from './exercises.providers.js';

/** Session-only upload and reference-image routes; catalog images remain read-only. */
@Controller('v1/workspaces/:workspaceId/exercises/:exerciseId/images')
@UseGuards(SessionAuthGuard)
export class ExerciseImagesController {
    constructor(
        @Inject(EXERCISE_IMAGES_SERVICE) private readonly images: ExerciseImagesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** Accepts one bounded multipart image after checking exercise access. */
    @Post()
    @HttpCode(200)
    async upload(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedQuery(postExerciseImageQuerySchema) query: PostExerciseImageQuery,
        @Req() request: FastifyRequest,
    ): Promise<ExerciseGuideImageResponse> {
        const scope = { userId: user.userId, workspaceId, exerciseId };
        await this.images.requireExercise(scope);
        const file = await request.file({ limits: { fileSize: MAX_EXERCISE_IMAGE_BYTES, files: 1, fields: 0 } });
        if (!file) throw new InvalidFormatError('Choose an image to upload');
        let bytes: Buffer;
        try {
            bytes = await file.toBuffer();
        } catch (error) {
            if (error instanceof request.server.multipartErrors.RequestFileTooLargeError) {
                throw new InvalidFormatError('Choose an image under 10 MB');
            }
            throw error;
        }

        const image = await this.images.upload({
            ...scope,
            bytes,
            contentType: file.mimetype,
            caption: query.caption,
        });
        return {
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: this.urls.webAppUrl({
                path: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images/${image.id}`,
            }),
        };
    }

    /** Serves private bytes without allowing intermediary or shared-browser caching. */
    @Get(':imageId')
    async download(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const { stream, contentType } = await this.images.download({
            userId: user.userId,
            workspaceId,
            exerciseId,
            imageId,
        });
        reply
            .header('Cache-Control', 'private, no-store')
            .header('X-Content-Type-Options', 'nosniff')
            .type(contentType)
            .send(stream);
    }

    /** Updates the optional caption. */
    @Patch(':imageId')
    async updateCaption(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
        @ValidatedBody(patchExerciseImageRequestSchema) body: PatchExerciseImageRequest,
    ): Promise<ExerciseGuideImageResponse> {
        const image = await this.images.updateCaption({
            userId: user.userId,
            workspaceId,
            exerciseId,
            imageId,
            ...body,
        });
        return {
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: this.urls.webAppUrl({
                path: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images/${imageId}`,
            }),
        };
    }

    /** Removes an image and its stored bytes. */
    @Delete(':imageId')
    @HttpCode(204)
    async remove(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
    ): Promise<void> {
        await this.images.remove({ userId: user.userId, workspaceId, exerciseId, imageId });
    }
}
