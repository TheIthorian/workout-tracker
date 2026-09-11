import {
    exerciseImageCaptionSchema,
    exerciseImageContentPath,
    guidSchema,
    type ExerciseGuideImageResponse,
} from '@app/api-contract';
import { EntityNotFoundError, InvalidFormatError, RequestValidationError } from '@app/errors';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionAuthGuard,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseGuideImage, ExerciseGuideService } from '@app/services';
import type { StorageService } from '@app/storage';
import type { MultipartFields } from '@fastify/multipart';
import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { STORAGE_SERVICE } from '../providers.js';
import { EXERCISE_GUIDE_SERVICE } from './exercises.providers.js';

/**
 * The content route serves these bytes back to a browser on this API's own origin, so anything
 * outside this set is a stored-XSS vector rather than merely an unsupported format.
 */
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * An exercise guide's images: upload, delete, and the byte-streaming content route.
 *
 * Session-only (`SessionAuthGuard`), split out from `ExerciseGuideController`'s link routes rather
 * than sharing its class-level `SessionOrMcpPatGuard`: an MCP client cannot send multipart form
 * data, and streaming raw image bytes back to a model has no use, so these three routes must not be
 * reachable by a personal access token at all - `route-guard-coverage.e2e.spec.ts` pins that.
 *
 * The membership check lives in `ExerciseGuideService`, as it does for every other route in this
 * slice.
 */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionAuthGuard)
export class ExerciseGuideImagesController {
    constructor(
        @Inject(EXERCISE_GUIDE_SERVICE) private readonly guides: ExerciseGuideService,
        @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** Uploads an image for the exercise's guide. */
    @Post(':exerciseId/images')
    @HttpCode(200)
    async uploadImage(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @Req() request: FastifyRequest,
    ): Promise<ExerciseGuideImageResponse> {
        // Before a byte is read: everything this check needs comes from the session and the path,
        // so an unauthorised caller must not be able to drive an upload to the bucket at all.
        await this.guides.requireExercise({ userId: currentUser.userId, workspaceId, exerciseId });

        const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES } });

        if (!file) throw new InvalidFormatError('An image file is required');

        if (!ALLOWED_IMAGE_CONTENT_TYPES.has(file.mimetype)) {
            throw new InvalidFormatError('Unsupported image type', 'Use PNG, JPEG, or WebP.');
        }

        const storageKey = await this.storage.uploadFile({
            fileStream: file.file,
            fileName: file.filename,
            contentType: file.mimetype,
        });

        // `file.file` is truncated rather than thrown when the per-file limit is hit, so the
        // upload can "succeed" with a partial object. Check afterwards and discard it.
        if (file.file.truncated) {
            await this.storage.deleteFile(storageKey);

            throw new InvalidFormatError('Image is too large', 'Images must be 10 MB or smaller.');
        }

        let image: ExerciseGuideImage;

        try {
            const caption = readCaption(file.fields);

            image = await this.guides.addImage({
                userId: currentUser.userId,
                workspaceId,
                exerciseId,
                storageKey,
                contentType: file.mimetype,
                caption,
            });
        } catch (error) {
            // Nothing references the object once the row fails to land, and a caller who may not
            // see the exercise must not be able to leave bytes in the bucket by trying. A failed
            // cleanup must not replace the error that caused it. `readCaption` can also throw here
            // (an over-length caption), so the same cleanup has to cover it too.
            await this.storage.deleteFile(storageKey).catch(() => undefined);

            throw error;
        }

        return {
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: this.urls.apiUrl({ path: exerciseImageContentPath({ workspaceId, exerciseId, imageId: image.id }) }),
        };
    }

    /**
     * Streams a guide image's bytes.
     *
     * `nosniff` plus the content type recorded at upload keeps a browser from re-interpreting the
     * bytes as anything other than the image type the upload route allowed. No `Content-Disposition`
     * filename is set: the uploaded name is attacker-controlled and never echoed back.
     */
    @Get(':exerciseId/images/:imageId/content')
    async getImageContent(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
        @Res({ passthrough: false }) reply: FastifyReply,
    ): Promise<void> {
        const image = await this.guides.getImage({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            imageId,
        });

        const body = await this.storage.tryDownloadFile(image.storageKey);

        if (!body) throw new EntityNotFoundError('Exercise image not found');

        await reply.header('content-type', image.contentType).header('x-content-type-options', 'nosniff').send(body);
    }

    /** Deletes a guide image and the stored object behind it. */
    @Delete(':exerciseId/images/:imageId')
    async deleteImage(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
    ): Promise<void> {
        const { storageKey } = await this.guides.removeImage({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            imageId,
        });

        // The row goes first: a failed object delete leaves an unreferenced object, which is
        // harmless, whereas the reverse order leaves a row pointing at nothing.
        await this.storage.deleteFile(storageKey);
    }
}

/**
 * The optional `caption` field posted alongside the file, or null when it is absent or blank.
 *
 * @throws RequestValidationError when the field is present but exceeds the contract's length limit.
 */
function readCaption(fields: MultipartFields): string | null {
    const caption = fields['caption'];

    if (caption === undefined || Array.isArray(caption) || caption.type !== 'field') return null;

    const result = exerciseImageCaptionSchema.safeParse(typeof caption.value === 'string' ? caption.value : undefined);

    if (!result.success) {
        throw new RequestValidationError({
            caption: result.error.issues.map((issue) => issue.message),
        });
    }

    return result.data && result.data.length > 0 ? result.data : null;
}
