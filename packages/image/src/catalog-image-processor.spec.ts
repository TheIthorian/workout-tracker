import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createCatalogImageProcessor, ImageTooLargeError } from './catalog-image-processor.js';

/** A solid-colour PNG of the given size, generated rather than checked in. */
async function png({ width, height }: { width: number; height: number }): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .png()
        .toBuffer();
}

describe('createCatalogImageProcessor', () => {
    const processor = createCatalogImageProcessor({ maxDimension: 1200, quality: 80 });

    it('converts to WebP and scales the longest side down to the maximum', async () => {
        const result = await processor.process(await png({ width: 1536, height: 1024 }));

        expect(processor.contentType).toBe('image/webp');
        expect(processor.extension).toBe('.webp');
        const meta = await sharp(result).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(1200);
        expect(meta.height).toBe(800);
    });

    it('scales by height when that is the longest side', async () => {
        const result = await processor.process(await png({ width: 600, height: 2400 }));

        const meta = await sharp(result).metadata();
        expect(meta.width).toBe(300);
        expect(meta.height).toBe(1200);
    });

    it('never upscales a small image', async () => {
        const result = await processor.process(await png({ width: 400, height: 300 }));

        const meta = await sharp(result).metadata();
        expect(meta.width).toBe(400);
        expect(meta.height).toBe(300);
    });

    it('rejects a source whose pixel dimensions are unreasonable', async () => {
        await expect(processor.process(await png({ width: 7000, height: 10 }))).rejects.toBeInstanceOf(
            ImageTooLargeError,
        );
    });

    it('rejects a source whose byte size is unreasonable', async () => {
        const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

        await expect(processor.process(oversized)).rejects.toBeInstanceOf(ImageTooLargeError);
    });

    it('names its variant from the settings so a changed setting changes the storage key', () => {
        expect(processor.variant).toBe('webp-1200-q80');
        expect(createCatalogImageProcessor({ maxDimension: 800, quality: 75 }).variant).toBe('webp-800-q75');
    });
});
