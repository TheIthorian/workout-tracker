import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    NoSuchKey,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Logger } from '@app/logger';

/**
 * The file extension including its leading dot, or an empty string when there is none. A trailing
 * dot yields no extension, and the search stops at a path separator so a dot in a directory name
 * is not mistaken for one.
 */
function getExtension(path: string): string {
    for (let i = path.length - 1; i >= 0; i--) {
        const char = path[i];
        if (char === '.') {
            return i !== path.length - 1 ? path.slice(i) : '';
        }
        if (char === '/' || char === '\\') {
            break;
        }
    }

    return '';
}

/**
 * Connection details for an S3-compatible bucket. Never sourced from the environment by this
 * package - the caller resolves configuration and injects it here.
 */
export interface StorageServiceConfig {
    /** Overrides the AWS endpoint. Required for MinIO or any other S3-compatible service. */
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /**
     * MinIO (and most S3-compatible services) require path-style addressing rather than the
     * virtual-hosted-style addressing real AWS S3 uses. This is not optional decoration - set it
     * to `true` for MinIO.
     */
    forcePathStyle: boolean;
}

/** Stores and retrieves files from S3-compatible storage. */
export class StorageService {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly logger: Logger;

    constructor({ config, logger }: { config: StorageServiceConfig; logger: Logger }) {
        this.logger = logger;
        this.bucket = config.bucket;

        this.client = new S3Client({
            region: config.region,
            endpoint: config.endpoint,
            forcePathStyle: config.forcePathStyle,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
    }

    async uploadFile({
        fileStream,
        fileName,
        contentType,
    }: {
        fileStream: Readable | Buffer;
        fileName: string;
        contentType: string;
    }): Promise<string> {
        // Random key with the extension retained, so a reader can still derive the served
        // Content-Type from it. The original filename is deliberately dropped rather than
        // embedded - store it alongside the key if you need it.
        const key = `${randomUUID()}${getExtension(fileName)}`;

        this.logger.info(
            { 's3.bucket': this.bucket, 's3.key': key, 'file.contentType': contentType },
            'Uploading file to S3',
        );

        await this.uploadFileAtKey({ fileStream, key, contentType });

        return key;
    }

    /**
     * Uploads to a caller-chosen key rather than generating one. Used where the key has to be
     * derivable from another object's key, such as the resized variants of an image.
     */
    async uploadFileAtKey({
        fileStream,
        key,
        contentType,
    }: {
        fileStream: Readable | Buffer;
        key: string;
        contentType: string;
    }): Promise<void> {
        this.logger.info(
            { 's3.bucket': this.bucket, 's3.key': key, 'file.contentType': contentType },
            'Uploading file to S3 at an explicit key',
        );

        // A plain `PutObjectCommand` requires a known Content-Length up front, which a Readable
        // of unknown length (e.g. piped from an HTTP request body) cannot supply - the AWS SDK
        // itself points at `Upload` for exactly this case. `Upload` also transparently handles
        // both `Buffer` and `Readable` bodies, so it is used unconditionally rather than only for
        // the stream case.
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: fileStream,
                ContentType: contentType,
            },
        });
        await upload.done();
    }

    /**
     * Copies an object to a new key inside the bucket, returning false when the source does not
     * exist. The copy happens in the storage service, so the bytes never travel through the API.
     */
    async copyFile({ sourceKey, destinationKey }: { sourceKey: string; destinationKey: string }): Promise<boolean> {
        this.logger.info(
            { 's3.bucket': this.bucket, 's3.sourceKey': sourceKey, 's3.key': destinationKey },
            'Copying file within S3',
        );

        try {
            await this.client.send(
                new CopyObjectCommand({
                    Bucket: this.bucket,
                    Key: destinationKey,
                    // `CopySource` is a header value, not a structured field, so the SDK does not
                    // encode it for us here. An un-encoded key containing non-ASCII characters
                    // (e.g. `crème brûlée`) makes S3/MinIO reject
                    // the request with `SignatureDoesNotMatch`, and a literal `+` is silently
                    // decoded by real S3 as a space, copying the wrong object.
                    //
                    // `encodeURIComponent` is used per path SEGMENT (via `split('/').map(...).join
                    // ('/')`) rather than over the whole key, because `encodeURIComponent` also
                    // escapes `/` - encoding the whole key would turn a legitimate multi-segment
                    // key like `uploads/123/thumbnail.jpg` into a single opaque segment that
                    // `x-amz-copy-source` cannot resolve to an object.
                    CopySource: `${this.bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
                }),
            );
            return true;
        } catch (error) {
            if (isNotFoundError(error)) {
                return false;
            }
            throw error;
        }
    }

    async downloadFile(key: string): Promise<Readable> {
        this.logger.info({ 's3.bucket': this.bucket, 's3.key': key }, 'Downloading file from S3');

        const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));

        return response.Body as Readable;
    }

    /**
     * Returns the object's contents, or null when no object exists at the key. Distinguishes a
     * missing object from a storage failure, which `downloadFile` cannot.
     */
    async tryDownloadFile(key: string): Promise<Readable | null> {
        try {
            return await this.downloadFile(key);
        } catch (error) {
            if (isNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Whether an object exists at the key, without fetching its bytes. A missing bucket still
     * throws, for the same reason `tryDownloadFile` does not swallow it.
     */
    async fileExists(key: string): Promise<boolean> {
        // Verify the bucket exists first, since HeadObject returns the same NotFound error for
        // both missing key and missing bucket. Any error from this check is a configuration
        // problem (missing or inaccessible bucket) and should propagate.
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));

        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        } catch (error) {
            if (isNotFoundError(error)) {
                return false;
            }
            throw error;
        }
    }

    async deleteFile(key: string): Promise<void> {
        this.logger.info({ 's3.bucket': this.bucket, 's3.key': key }, 'Deleting file from S3');

        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
}

/**
 * Discriminates "the key does not exist" from any other storage failure - most importantly, from
 * "the bucket does not exist". S3 and MinIO both answer a missing key AND a missing bucket with
 * HTTP 404, so a bare `$metadata.httpStatusCode === 404` check (this function's previous
 * implementation) misclassifies a misconfigured bucket as "no object": `copyFile` would return
 * `false` and `tryDownloadFile` would return `null` for a renamed or deleted bucket, silently
 * hiding every stored object with no error surfaced anywhere.
 *
 * Verified live against a throwaway MinIO container: `GetObjectCommand` and `CopyObjectCommand`
 * (the only two operations that call this) throw a typed `NoSuchKey` for a missing key, and a
 * distinctly-named `NoSuchBucket` for a missing bucket - both at status 404. Only `NoSuchKey` is
 * treated as absence here; `NoSuchBucket` (and everything else) propagates as a thrown error.
 *
 * Branching on a 404 status alone would conflate the two and lose data silently rather than
 * surface a fixable configuration error.
 *
 * `HeadObjectCommand` returns a `NotFound` error for both missing key and missing bucket, so
 * `fileExists` first checks the bucket exists with `HeadBucketCommand`. Any `NotFound` error
 * from `HeadObjectCommand` after the bucket check must be a missing key.
 */
function isNotFoundError(error: unknown): boolean {
    if (error instanceof NoSuchKey) {
        return true;
    }

    return (
        error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        ((error as { name: unknown }).name === 'NoSuchKey' || (error instanceof Error && error.name === 'NotFound'))
    );
}
