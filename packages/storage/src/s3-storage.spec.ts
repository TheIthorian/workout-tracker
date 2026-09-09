import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { createLogger } from '@app/logger';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from './s3-storage.js';

const BUCKET = 'storage-test-bucket';
const ACCESS_KEY_ID = 'minioadmin';
const SECRET_ACCESS_KEY = 'minioadmin';

let container: StartedTestContainer;
let service: StorageService;
// Points at the same MinIO container, credentials and all, but a bucket that was never created -
// the "storage is misconfigured" case the not-found check must NOT swallow (see the Critical
// fix in `isNotFoundError`).
let wrongBucketService: StorageService;

beforeAll(async () => {
    // MinIO is already the S3-compatible service this monorepo runs in dev (see the root
    // compose.yaml `minio` service), so the image is likely already local - this throwaway
    // container is unrelated to any long-lived local MinIO, which must never be touched by tests.
    // Pinned to a specific release tag per the repo's standing "everything is pinned" rule (see
    // `packages/db`, which pins `postgres:17`). `RELEASE.2025-09-07T16-13-09Z` is the last tag
    // published to the official `minio/minio` Docker Hub image before that repo was archived.
    container = await new GenericContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
        .withEntrypoint(['bash'])
        .withCommand([
            '-c',
            'mkdir -p /data/drive/test && /usr/bin/minio server /data/drive/test --console-address ":9001"',
        ])
        .withEnvironment({ MINIO_ROOT_USER: ACCESS_KEY_ID, MINIO_ROOT_PASSWORD: SECRET_ACCESS_KEY })
        .withExposedPorts(9000)
        .start();

    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;

    const bootstrapClient = new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
    await bootstrapClient.send(new CreateBucketCommand({ Bucket: BUCKET }));
    bootstrapClient.destroy();

    const logger = createLogger({ context: 'storage-test', config: { level: 'error', pretty: false, redact: false } });

    service = new StorageService({
        config: {
            endpoint,
            region: 'us-east-1',
            bucket: BUCKET,
            accessKeyId: ACCESS_KEY_ID,
            secretAccessKey: SECRET_ACCESS_KEY,
            forcePathStyle: true,
        },
        logger,
    });

    wrongBucketService = new StorageService({
        config: {
            endpoint,
            region: 'us-east-1',
            bucket: 'no-such-bucket-at-all',
            accessKeyId: ACCESS_KEY_ID,
            secretAccessKey: SECRET_ACCESS_KEY,
            forcePathStyle: true,
        },
        logger,
    });
}, 120_000);

afterAll(async () => {
    await container.stop();
});

async function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function streamToString(stream: Readable): Promise<string> {
    return (await streamToBuffer(stream)).toString('utf8');
}

describe('StorageService', () => {
    it('round-trips an upload and download', async () => {
        const key = await service.uploadFile({
            fileStream: Buffer.from('hello world'),
            fileName: 'greeting.txt',
            contentType: 'text/plain',
        });

        expect(key).toMatch(/^[0-9a-f-]{36}\.txt$/);

        const downloaded = await service.downloadFile(key);
        await expect(streamToString(downloaded)).resolves.toBe('hello world');
    });

    it('uploadFileAtKey honours the caller-chosen key rather than generating one', async () => {
        const key = 'uploads/123/thumbnail.jpg';

        await service.uploadFileAtKey({
            fileStream: Buffer.from('thumbnail bytes'),
            key,
            contentType: 'image/jpeg',
        });

        const downloaded = await service.downloadFile(key);
        await expect(streamToString(downloaded)).resolves.toBe('thumbnail bytes');
    });

    it('copyFile returns false when the source does not exist', async () => {
        const copied = await service.copyFile({ sourceKey: 'does/not/exist.txt', destinationKey: 'irrelevant.txt' });

        expect(copied).toBe(false);
    });

    it('copyFile copies an existing object and returns true', async () => {
        const sourceKey = await service.uploadFile({
            fileStream: Buffer.from('copy me'),
            fileName: 'source.txt',
            contentType: 'text/plain',
        });
        const destinationKey = 'copies/source-copy.txt';

        const copied = await service.copyFile({ sourceKey, destinationKey });

        expect(copied).toBe(true);
        const downloaded = await service.downloadFile(destinationKey);
        await expect(streamToString(downloaded)).resolves.toBe('copy me');
    });

    it('copyFile copies an object whose key contains non-ASCII characters', async () => {
        // Generated keys are now `${randomUUID()}${extension}` and never carry the original
        // filename (see the `uploadFile` behaviour change), so this exercises the CopySource
        // encoding path directly via an explicit non-ASCII key through `uploadFileAtKey`. Also
        // exercises a key containing `+`, which real S3 (unlike a naive decode) treats as a
        // literal character rather than a space.
        const sourceKey = 'crème brûlée a+b.txt';
        await service.uploadFileAtKey({
            fileStream: Buffer.from('creme brulee bytes'),
            key: sourceKey,
            contentType: 'text/plain',
        });
        const destinationKey = 'copies/crème brûlée-copy.txt';

        const copied = await service.copyFile({ sourceKey, destinationKey });

        expect(copied).toBe(true);
        const downloaded = await service.downloadFile(destinationKey);
        await expect(streamToString(downloaded)).resolves.toBe('creme brulee bytes');
    });

    it('tryDownloadFile returns null for a missing key while downloadFile throws for the same key', async () => {
        const missingKey = 'no/such/object.txt';

        await expect(service.tryDownloadFile(missingKey)).resolves.toBeNull();
        await expect(service.downloadFile(missingKey)).rejects.toThrow();
    });

    it('deleteFile makes a key absent', async () => {
        const key = await service.uploadFile({
            fileStream: Buffer.from('temporary'),
            fileName: 'temp.txt',
            contentType: 'text/plain',
        });

        await service.deleteFile(key);

        await expect(service.tryDownloadFile(key)).resolves.toBeNull();
    });

    it('copyFile throws (not false) when the bucket itself does not exist', async () => {
        // A missing bucket and a missing key both answer with HTTP 404 - the bug this guards
        // against is treating the two as the same thing. Only key-level absence should return
        // false; a misconfigured bucket must surface as an error.
        await expect(
            wrongBucketService.copyFile({ sourceKey: 'irrelevant.txt', destinationKey: 'also-irrelevant.txt' }),
        ).rejects.toThrow();
    });

    it('tryDownloadFile throws (not null) when the bucket itself does not exist', async () => {
        await expect(wrongBucketService.tryDownloadFile('irrelevant.txt')).rejects.toThrow();
    });

    it('uploads a Readable stream, not just a Buffer', async () => {
        const key = await service.uploadFile({
            fileStream: Readable.from(Buffer.from('streamed content')),
            fileName: 'streamed.txt',
            contentType: 'text/plain',
        });

        const downloaded = await service.downloadFile(key);
        await expect(streamToString(downloaded)).resolves.toBe('streamed content');
    });

    it('round-trips a large binary payload with byte-for-byte equality', async () => {
        const payload = randomBytes(5 * 1024 * 1024); // 5 MiB - large enough to span multiple chunks.

        const key = await service.uploadFile({
            fileStream: Readable.from(payload),
            fileName: 'large.bin',
            contentType: 'application/octet-stream',
        });

        const downloaded = await service.downloadFile(key);
        const downloadedBuffer = await streamToBuffer(downloaded);

        expect(downloadedBuffer).toHaveLength(payload.length);
        expect(downloadedBuffer.equals(payload)).toBe(true);
    });
});
