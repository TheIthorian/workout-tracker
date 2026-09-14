import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { exerciseDetailResponseSchema, exerciseGuideImageResponseSchema } from '@app/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE_SERVICE } from '../src/providers.js';
import { createTestApp, signIn, type TestApp } from './harness.js';

const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=',
    'base64',
);
const objects = new Map<string, Buffer>();
let app: TestApp;
let owner: { cookie: string; workspaceId: string; exerciseId: string };
let outsider: { cookie: string; workspaceId: string; exerciseId: string };

beforeAll(async () => {
    app = await createTestApp({
        overrides: [
            {
                provide: STORAGE_SERVICE,
                useValue: {
                    uploadFileAtKey: async ({
                        key,
                        fileStream,
                    }: {
                        key: string;
                        fileStream: Buffer;
                    }): Promise<void> => {
                        objects.set(key, fileStream);
                    },
                    tryDownloadFile: async (key: string): Promise<Readable | null> =>
                        objects.has(key) ? Readable.from(objects.get(key)!) : null,
                    deleteFile: async (key: string): Promise<void> => {
                        objects.delete(key);
                    },
                },
            },
        ],
    });
    owner = await createOwner();
    outsider = await createOwner();
});
afterAll(async () => {
    await app?.close();
});

describe('private exercise images', () => {
    it('uploads, reads, captions, and removes an image through the real workspace routes', async () => {
        const uploaded = await upload(owner);
        expect(uploaded.statusCode).toBe(200);
        const image = exerciseGuideImageResponseSchema.parse(JSON.parse(uploaded.body));
        expect(image.caption).toBe('Starting position');
        expect(image.url).toContain(
            `/api/v1/workspaces/${owner.workspaceId}/exercises/${owner.exerciseId}/images/${image.id}`,
        );
        const path = `${base(owner)}/${image.id}`;
        const read = await app.inject({ method: 'GET', url: path, headers: { cookie: owner.cookie } });
        expect(read.statusCode).toBe(200);
        expect(read.headers['cache-control']).toBe('private, no-store');
        expect(read.headers['content-type']).toBe('image/png');
        expect(read.rawPayload).toEqual(bytes);
        const patched = await app.inject({
            method: 'PATCH',
            url: path,
            headers: { cookie: owner.cookie },
            payload: { caption: 'Finish position' },
        });
        expect(patched.statusCode).toBe(200);
        const detail = await app.inject({
            method: 'GET',
            url: base(owner).replace('/images', ''),
            headers: { cookie: owner.cookie },
        });
        expect(exerciseDetailResponseSchema.parse(JSON.parse(detail.body)).images).toEqual([
            { ...image, caption: 'Finish position' },
        ]);
        expect((await app.inject({ method: 'DELETE', url: path, headers: { cookie: owner.cookie } })).statusCode).toBe(
            204,
        );
        expect((await app.inject({ method: 'GET', url: path, headers: { cookie: owner.cookie } })).statusCode).toBe(
            404,
        );
        expect(objects.size).toBe(0);
    });

    it('refuses non-members, cross-tenant ids, and sibling exercise ids without changing bytes', async () => {
        const image = exerciseGuideImageResponseSchema.parse(JSON.parse((await upload(owner)).body));
        const paths = [
            base(owner),
            base({ workspaceId: outsider.workspaceId, exerciseId: owner.exerciseId }),
            base(outsider),
        ];
        for (const path of paths) {
            for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
                const response = await app.inject({
                    method,
                    url: `${path}/${image.id}`,
                    headers: { cookie: outsider.cookie },
                    ...(method === 'PATCH' ? { payload: { caption: 'Not yours' } } : {}),
                });
                expect(response.statusCode).toBe(404);
            }
        }
        expect((await upload({ ...owner, cookie: outsider.cookie })).statusCode).toBe(404);
        expect((await upload({ ...owner, workspaceId: outsider.workspaceId })).statusCode).toBe(404);
        expect(objects.size).toBe(1);
        expect(
            (
                await app.inject({
                    method: 'DELETE',
                    url: `${base(owner)}/${image.id}`,
                    headers: { cookie: owner.cookie },
                })
            ).statusCode,
        ).toBe(204);
    });

    it('requires a session and validates image contents before storing anything', async () => {
        expect((await app.inject({ method: 'POST', url: base(owner) })).statusCode).toBe(401);
        expect((await upload({ ...owner, fileBytes: Buffer.from('<svg onload="alert(1)"></svg>') })).statusCode).toBe(
            400,
        );
        expect(objects.size).toBe(0);
    });
});

function base({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/images`;
}

async function upload({
    cookie,
    fileBytes = bytes,
    ...scope
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
    fileBytes?: Buffer;
}): ReturnType<TestApp['inject']> {
    const boundary = 'forma-image-boundary';
    const payload = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        fileBytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
        method: 'POST',
        url: `${base(scope)}?caption=Starting%20position`,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
    });
}

async function createOwner(): Promise<{ cookie: string; workspaceId: string; exerciseId: string }> {
    const email = `image-${randomUUID()}@example.com`;
    const password = 'local-image-test-password';
    const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });
    expect(signup.statusCode).toBe(200);
    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/workspaces', headers: { cookie } });
    const workspaces: { workspaceId: string }[] = JSON.parse(me.body);
    const workspaceId = workspaces[0].workspaceId;
    const created = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload: { name: 'Custom squat', trackingType: 'weight_reps' },
    });
    return { cookie, workspaceId, exerciseId: exerciseDetailResponseSchema.parse(JSON.parse(created.body)).id };
}
