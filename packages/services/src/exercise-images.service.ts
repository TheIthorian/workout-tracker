import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ExerciseImageContentType, MAX_EXERCISE_IMAGE_BYTES } from '@app/api-contract';
import { EntityNotFoundError, InvalidFormatError } from '@app/errors';
import type { StorageService } from '@app/storage';
import type { ExerciseGuideService } from './exercise-guide.service.js';
import type { ExerciseGuideImage } from './exercises.service.js';

type ExerciseScope = { userId: string; workspaceId: string; exerciseId: string };
type ImageScope = ExerciseScope & { imageId: string };

/** Stores private guide images after the same membership and tenant checks as guide text. */
export class ExerciseImagesService {
    private readonly guides: ExerciseGuideService;
    private readonly storage: StorageService;
    constructor({ guides, storage }: { guides: ExerciseGuideService; storage: StorageService }) {
        this.guides = guides;
        this.storage = storage;
    }

    /** Checks access before the transport buffers an upload. */
    async requireExercise(scope: ExerciseScope): Promise<void> {
        await this.guides.requireExercise(scope);
    }

    /** Validates and stores an image, removing its object if recording it fails. */
    async upload({
        bytes,
        contentType,
        caption,
        ...scope
    }: ExerciseScope & { bytes: Buffer; contentType: string; caption?: string }): Promise<ExerciseGuideImage> {
        await this.guides.requireExercise(scope);
        validateImage({ bytes, contentType });
        const storageKey = `private/workspaces/${scope.workspaceId}/exercises/${scope.exerciseId}/${randomUUID()}`;
        await this.storage.uploadFileAtKey({ key: storageKey, fileStream: bytes, contentType });
        try {
            return await this.guides.addImage({ ...scope, storageKey, contentType, caption });
        } catch (error) {
            await this.storage.deleteFile(storageKey);
            throw error;
        }
    }

    /** Retrieves bytes only after verifying access to both the workspace and exercise. */
    async download(scope: ImageScope): Promise<{ stream: Readable; contentType: string }> {
        const image = await this.guides.getImage(scope);
        const stream = await this.storage.tryDownloadFile(image.storageKey);
        if (!stream) throw new EntityNotFoundError('Exercise image not found');
        return { stream, contentType: image.contentType };
    }

    /** Changes an image’s optional caption. */
    async updateCaption(scope: ImageScope & { caption: string | null }): Promise<ExerciseGuideImage> {
        return this.guides.updateImage(scope);
    }

    /** Removes bytes before the record so storage failures remain retryable. */
    async remove(scope: ImageScope): Promise<void> {
        const image = await this.guides.getImage(scope);
        await this.storage.deleteFile(image.storageKey);
        await this.guides.removeImage(scope);
    }
}

function validateImage({ bytes, contentType }: { bytes: Buffer; contentType: string }): void {
    if (!bytes.length || bytes.length > MAX_EXERCISE_IMAGE_BYTES)
        throw new InvalidFormatError('Choose an image under 10 MB');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (
        !(
            (contentType === ExerciseImageContentType.Png && png) ||
            (contentType === ExerciseImageContentType.Jpeg && jpeg) ||
            (contentType === ExerciseImageContentType.Webp && webp)
        )
    )
        throw new InvalidFormatError('Choose a JPG, PNG, or WebP image');
}
