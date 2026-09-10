import {
    exerciseImageContentPath,
    guidSchema,
    patchExerciseLinkRequestSchema,
    postExerciseLinkRequestSchema,
    type ExerciseGuideImageResponse,
    type ExerciseLinkResponse,
    type PatchExerciseLinkRequest,
    type PostExerciseLinkRequest,
} from '@app/api-contract';
import { EntityNotFoundError, InvalidFormatError } from '@app/errors';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionOrMcpPatGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseGuideImage, ExerciseGuideService } from '@app/services';
import type { StorageService } from '@app/storage';
import type { MultipartFields } from '@fastify/multipart';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
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
 * An exercise guide's attachments: its external links, and its images.
 *
 * Image bytes are served from `:imageId/content` rather than from a bucket url, because a public
 * url would be an unauthenticated read of workspace-owned content. The membership check lives in
 * `ExerciseGuideService`, as it does for every other route in this slice.
 */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionOrMcpPatGuard)
export class ExerciseGuideController {
    constructor(
        @Inject(EXERCISE_GUIDE_SERVICE) private readonly guides: ExerciseGuideService,
        @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** Appends an external link to the exercise's guide. */
    @Post(':exerciseId/links')
    @HttpCode(200)
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

    /** Updates a link. An omitted key leaves the stored value alone. */
    @Patch(':exerciseId/links/:linkId')
    async patchLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
        @ValidatedBody(patchExerciseLinkRequestSchema) body: PatchExerciseLinkRequest,
    ): Promise<ExerciseLinkResponse> {
        return this.guides.updateLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId, ...body });
    }

    /** Deletes a link from the exercise's guide. */
    @Delete(':exerciseId/links/:linkId')
    async deleteLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
    ): Promise<void> {
        await this.guides.removeLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId });
    }

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

        const caption = readCaption(file.fields);

        let image: ExerciseGuideImage;

        try {
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
            // cleanup must not replace the error that caused it.
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

/** The optional `caption` field posted alongside the file, or null when it is absent or blank. */
function readCaption(fields: MultipartFields): string | null {
    const caption = fields['caption'];

    if (caption === undefined || Array.isArray(caption) || caption.type !== 'field') return null;

    return typeof caption.value === 'string' && caption.value !== '' ? caption.value : null;
}
