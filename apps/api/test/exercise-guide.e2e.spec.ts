import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '@app/logger';
import { StorageService } from '@app/storage';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE_SERVICE } from '../src/providers.js';
import { createTestApp, signIn, type TestApp } from './harness.js';

const BUCKET = 'exercise-guide-test-bucket';
const ACCESS_KEY_ID = 'minioadmin';
const SECRET_ACCESS_KEY = 'minioadmin';

/** A one-pixel PNG. Real bytes, so the content route's round-trip is a real round-trip. */
const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

let app: TestApp;
let minio: StartedTestContainer;
let s3: S3Client;

beforeAll(async () => {
    // A real bucket rather than a fake storage service: this suite exists to prove the upload,
    // the truncation cleanup and the content round-trip work against S3, and a fake would
    // exercise none of that. Pinned to the same image `packages/storage`'s own spec uses.
    minio = await new GenericContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
        .withEntrypoint(['bash'])
        .withCommand([
            '-c',
            'mkdir -p /data/drive/test && /usr/bin/minio server /data/drive/test --console-address ":9001"',
        ])
        .withEnvironment({ MINIO_ROOT_USER: ACCESS_KEY_ID, MINIO_ROOT_PASSWORD: SECRET_ACCESS_KEY })
        .withExposedPorts(9000)
        .start();

    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

    s3 = new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

    const storage = new StorageService({
        config: {
            endpoint,
            region: 'us-east-1',
            bucket: BUCKET,
            accessKeyId: ACCESS_KEY_ID,
            secretAccessKey: SECRET_ACCESS_KEY,
            forcePathStyle: true,
        },
        logger: createLogger({ context: 'guide-test', config: { level: 'error', pretty: false, redact: false } }),
    });

    app = await createTestApp({ overrides: [{ provide: STORAGE_SERVICE, useValue: storage }] });
});

afterAll(async () => {
    await app?.close();
    s3?.destroy();
    await minio?.stop();
});

describe('guide link routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${randomUUID()}/exercises/${randomUUID()}/links`,
            payload: { url: 'https://example.com' },
        });

        expect(response.statusCode).toBe(401);
    });

    it('appends links in order', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const first = await postLink({ cookie, workspaceId, exerciseId, payload: { url: 'https://example.com/a' } });
        const second = await postLink({
            cookie,
            workspaceId,
            exerciseId,
            payload: { url: 'https://example.com/b', label: 'Second' },
        });

        expect(first.statusCode).toBe(200);
        expect(JSON.parse(first.body)).toMatchObject({ url: 'https://example.com/a', label: null, position: 0 });
        expect(JSON.parse(second.body)).toMatchObject({ url: 'https://example.com/b', label: 'Second', position: 1 });
    });

    it('patches only the field given', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });
        const link = JSON.parse(
            (
                await postLink({
                    cookie,
                    workspaceId,
                    exerciseId,
                    payload: { url: 'https://example.com/x', label: 'Old' },
                })
            ).body,
        ) as { id: string };

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${link.id}`,
            headers: { cookie },
            payload: { label: 'New' },
        });

        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({ url: 'https://example.com/x', label: 'New' });
    });

    it('deletes a link, and it leaves the exercise detail', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });
        const link = JSON.parse(
            (await postLink({ cookie, workspaceId, exerciseId, payload: { url: 'https://example.com/doomed' } })).body,
        ) as { id: string };

        const deleted = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${link.id}`,
            headers: { cookie },
        });

        expect(deleted.statusCode).toBe(200);

        const detail = await getDetail({ cookie, workspaceId, exerciseId });
        expect(detail.links).toHaveLength(0);
    });
});

describe('guide image routes', () => {
    it('uploads an image, serves its bytes back, and links it from the exercise detail', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const uploaded = await postImage({
            cookie,
            workspaceId,
            exerciseId,
            contentType: 'image/png',
            content: PNG_BYTES,
            caption: 'Bottom position',
        });

        expect(uploaded.statusCode).toBe(200);
        const image = JSON.parse(uploaded.body) as { id: string; caption: string | null; url: string };
        expect(image).toMatchObject({
            caption: 'Bottom position',
            position: 0,
            url: `/workspaces/${workspaceId}/exercises/${exerciseId}/images/${image.id}/content`,
        });

        const content = await app.inject({ method: 'GET', url: `/api/v1${image.url}`, headers: { cookie } });

        expect(content.statusCode).toBe(200);
        expect(content.headers['content-type']).toBe('image/png');
        expect(content.headers['x-content-type-options']).toBe('nosniff');
        expect(content.rawPayload.equals(PNG_BYTES)).toBe(true);

        const detail = await getDetail({ cookie, workspaceId, exerciseId });
        expect(detail.images).toEqual([expect.objectContaining({ id: image.id, url: image.url })]);
    });

    it('returns 401 for the content route when signed out', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });
        const image = JSON.parse(
            (await postImage({ cookie, workspaceId, exerciseId, contentType: 'image/png', content: PNG_BYTES })).body,
        ) as { url: string };

        const response = await app.inject({ method: 'GET', url: `/api/v1${image.url}` });

        expect(response.statusCode).toBe(401);
    });

    // An uploaded text/html file served back on the API's own origin would execute in the
    // victim's session, so the declared content type is checked against an allowlist.
    it('rejects a content type outside the image allowlist', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const before = await countStoredObjects();

        const response = await postImage({
            cookie,
            workspaceId,
            exerciseId,
            contentType: 'text/html',
            content: Buffer.from('<script>alert(1)</script>'),
            fileName: 'payload.html',
        });

        expect(response.statusCode).toBe(400);
        expect(await countStoredObjects()).toBe(before);

        const detail = await getDetail({ cookie, workspaceId, exerciseId });
        expect(detail.images).toHaveLength(0);
    });

    // `@fastify/multipart` truncates at the per-file limit rather than throwing, so the upload
    // "succeeds" with a partial object. Neither the object nor a row may survive.
    it('rejects an oversized image and leaves no partial object behind', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const before = await countStoredObjects();

        const response = await postImage({
            cookie,
            workspaceId,
            exerciseId,
            contentType: 'image/png',
            content: Buffer.alloc(MAX_IMAGE_BYTES + 1024, 7),
        });

        expect(response.statusCode).toBe(400);
        expect(await countStoredObjects()).toBe(before);

        const detail = await getDetail({ cookie, workspaceId, exerciseId });
        expect(detail.images).toHaveLength(0);
    });

    it('deletes the image, its stored object, and 404s the content route afterwards', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const before = await countStoredObjects();
        const image = JSON.parse(
            (await postImage({ cookie, workspaceId, exerciseId, contentType: 'image/webp', content: PNG_BYTES })).body,
        ) as { id: string; url: string };

        expect(await countStoredObjects()).toBe(before + 1);

        const deleted = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images/${image.id}`,
            headers: { cookie },
        });

        expect(deleted.statusCode).toBe(200);
        expect(await countStoredObjects()).toBe(before);

        const content = await app.inject({ method: 'GET', url: `/api/v1${image.url}`, headers: { cookie } });

        expect(content.statusCode).toBe(404);
    });
});

describe('cross-workspace access', () => {
    it("returns 404 on every guide route for another workspace's exercise", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const exerciseId = await createExercise({ cookie: owner.cookie, workspaceId: owner.workspaceId });

        const link = JSON.parse(
            (
                await postLink({
                    cookie: owner.cookie,
                    workspaceId: owner.workspaceId,
                    exerciseId,
                    payload: { url: 'https://example.com/theirs' },
                })
            ).body,
        ) as { id: string };
        const image = JSON.parse(
            (
                await postImage({
                    cookie: owner.cookie,
                    workspaceId: owner.workspaceId,
                    exerciseId,
                    contentType: 'image/png',
                    content: PNG_BYTES,
                })
            ).body,
        ) as { id: string };

        // The outsider names their OWN workspace with the owner's exercise id: the workspace is
        // one they belong to, so only the tenant filter on the exercise itself refuses them.
        const base = `/api/v1/workspaces/${outsider.workspaceId}/exercises/${exerciseId}`;
        const headers = { cookie: outsider.cookie };
        const storedBefore = await countStoredObjects();

        const responses = await Promise.all([
            app.inject({ method: 'POST', url: `${base}/links`, headers, payload: { url: 'https://example.com/x' } }),
            app.inject({ method: 'PATCH', url: `${base}/links/${link.id}`, headers, payload: { label: 'Hijacked' } }),
            app.inject({ method: 'DELETE', url: `${base}/links/${link.id}`, headers }),
            app.inject({ method: 'DELETE', url: `${base}/images/${image.id}`, headers }),
            app.inject({ method: 'GET', url: `${base}/images/${image.id}/content`, headers }),
            postImage({
                cookie: outsider.cookie,
                workspaceId: outsider.workspaceId,
                exerciseId,
                contentType: 'image/png',
                content: PNG_BYTES,
            }),
        ]);

        expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404, 404]);

        // A refused upload must not leave its bytes in the bucket either.
        expect(await countStoredObjects()).toBe(storedBefore);

        const detail = await getDetail({
            cookie: owner.cookie,
            workspaceId: owner.workspaceId,
            exerciseId,
        });
        expect(detail.links).toEqual([expect.objectContaining({ id: link.id, label: null })]);
        expect(detail.images).toEqual([expect.objectContaining({ id: image.id })]);
    });
});

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
    const email = `guide-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { userId: string; workspaces: { workspaceId: string }[] };

    return { cookie, userId: body.userId, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise({ cookie, workspaceId }: { cookie: string; workspaceId: string }): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload: { name: 'Bench Press', trackingType: 'weight_reps' },
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

async function getDetail({
    cookie,
    workspaceId,
    exerciseId,
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
}): Promise<{ images: { id: string; url: string }[]; links: { id: string; label: string | null }[] }> {
    const response = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
        headers: { cookie },
    });

    return JSON.parse(response.body) as {
        images: { id: string; url: string }[];
        links: { id: string; label: string | null }[];
    };
}

function postLink({
    cookie,
    workspaceId,
    exerciseId,
    payload,
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
    payload: Record<string, unknown>;
}): ReturnType<TestApp['inject']> {
    return app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links`,
        headers: { cookie },
        payload,
    });
}

function postImage({
    cookie,
    workspaceId,
    exerciseId,
    contentType,
    content,
    caption,
    fileName = 'guide.png',
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
    contentType: string;
    content: Buffer;
    caption?: string;
    fileName?: string;
}): ReturnType<TestApp['inject']> {
    const boundary = `----exercise-guide-${randomUUID()}`;

    return app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images`,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: multipartBody({ boundary, contentType, content, caption, fileName }),
    });
}

/**
 * A multipart body with the caption field ahead of the file part: `request.file()` resolves at the
 * first file, so a field written after it would not be on `file.fields`.
 */
function multipartBody({
    boundary,
    contentType,
    content,
    caption,
    fileName,
}: {
    boundary: string;
    contentType: string;
    content: Buffer;
    caption?: string;
    fileName: string;
}): Buffer {
    const parts: Buffer[] = [];

    if (caption !== undefined) {
        parts.push(
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
        );
    }

    parts.push(
        Buffer.from(
            `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                `Content-Type: ${contentType}\r\n\r\n`,
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    );

    return Buffer.concat(parts);
}

/** How many objects the bucket holds, so a test can prove an upload left nothing behind. */
async function countStoredObjects(): Promise<number> {
    const response = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));

    return response.KeyCount ?? 0;
}
