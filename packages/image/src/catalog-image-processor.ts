import { ImageTooLargeError } from '@app/errors';
import sharp from 'sharp';

/**
 * Turns a source image into the bytes that get published. The output format is fixed per
 * processor, so `contentType` and `extension` are known without processing anything. `variant`
 * names the settings in effect, so a caller that content-addresses its output can fold it into
 * the key: a changed setting must produce a new key, while the same setting on the same source
 * must not.
 */
export interface ImageProcessor {
    readonly variant: string;
    readonly contentType: string;
    /** Including the leading dot, e.g. `.webp`. */
    readonly extension: string;
    process(source: Buffer): Promise<Buffer>;
}

/** Above this the source is refused before decoding - a decode bomb is not worth the risk. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 6000;

/**
 * Scales the longest side down to `maxDimension` (never up), re-encodes as WebP at `quality` and
 * drops all metadata. Refuses sources over 10 MB or 6000 px on either side with an
 * `ImageTooLargeError`.
 */
export function createCatalogImageProcessor({
    maxDimension,
    quality,
}: {
    maxDimension: number;
    quality: number;
}): ImageProcessor {
    return {
        variant: `webp-${maxDimension}-q${quality}`,
        contentType: 'image/webp',
        extension: '.webp',

        async process(source: Buffer): Promise<Buffer> {
            if (source.byteLength > MAX_SOURCE_BYTES) {
                throw new ImageTooLargeError(`Image is ${source.byteLength} bytes; the limit is ${MAX_SOURCE_BYTES}`);
            }

            const { width, height } = await sharp(source).metadata();
            if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
                throw new ImageTooLargeError(
                    `Image is ${width}x${height} px; neither side may exceed ${MAX_SOURCE_DIMENSION}`,
                );
            }

            // `withoutEnlargement` keeps a small source at its own size instead of blurring it up;
            // `fit: 'inside'` keeps the aspect ratio and constrains whichever side is longest.
            return sharp(source)
                .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
                .webp({ quality })
                .toBuffer();
        },
    };
}
