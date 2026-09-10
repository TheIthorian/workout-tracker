import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExerciseGuideService } from './exercise-guide.service.js';
import { ExercisesService } from './exercises.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let exercises: ExercisesService;
let guides: ExerciseGuideService;

let userId: string;
let workspaceId: string;
let exerciseId: string;
let outsiderId: string;
let otherWorkspaceId: string;
let otherExerciseId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    exercises = new ExercisesService({ db, membership });
    guides = new ExerciseGuideService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    exerciseId = (
        await exercises.create({ userId, workspaceId, name: 'Bench Press', trackingType: TrackingType.WeightReps })
    ).id;

    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
    otherExerciseId = (
        await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'Theirs',
            trackingType: TrackingType.WeightReps,
        })
    ).id;
});

afterAll(async () => {
    await database?.stop();
});

describe('addLink', () => {
    it('appends links in order', async () => {
        const first = await guides.addLink({
            userId,
            workspaceId,
            exerciseId,
            url: 'https://example.com/one',
            label: 'One',
        });
        const second = await guides.addLink({ userId, workspaceId, exerciseId, url: 'https://example.com/two' });

        expect(first.position).toBe(0);
        expect(second.position).toBe(1);
        expect(second.label).toBeNull();
    });

    it('refuses an exercise in another workspace', async () => {
        await expect(
            guides.addLink({ userId, workspaceId, exerciseId: otherExerciseId, url: 'https://example.com/x' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            guides.addLink({
                userId,
                workspaceId: otherWorkspaceId,
                exerciseId: otherExerciseId,
                url: 'https://example.com/x',
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('updateLink', () => {
    it('writes only the fields given', async () => {
        const link = await guides.addLink({
            userId,
            workspaceId,
            exerciseId,
            url: 'https://example.com/before',
            label: 'Keep me',
        });

        const updated = await guides.updateLink({
            userId,
            workspaceId,
            exerciseId,
            linkId: link.id,
            url: 'https://example.com/after',
        });

        expect(updated).toMatchObject({ url: 'https://example.com/after', label: 'Keep me' });
    });

    it('throws EntityNotFoundError for an unknown link', async () => {
        await expect(
            guides.updateLink({ userId, workspaceId, exerciseId, linkId: randomUUID(), label: 'x' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('removeLink', () => {
    it('deletes the link', async () => {
        const link = await guides.addLink({ userId, workspaceId, exerciseId, url: 'https://example.com/doomed' });

        await guides.removeLink({ userId, workspaceId, exerciseId, linkId: link.id });

        const detail = await exercises.get({ userId, workspaceId, exerciseId });
        expect(detail.links.map((entry) => entry.id)).not.toContain(link.id);
    });
});

describe('images', () => {
    it('records an uploaded image and returns its storage key when removed', async () => {
        const image = await guides.addImage({
            userId,
            workspaceId,
            exerciseId,
            storageKey: 'abc123.png',
            contentType: 'image/png',
            caption: 'Bottom position',
        });

        expect(image).toMatchObject({ caption: 'Bottom position', position: 0 });

        const removed = await guides.removeImage({ userId, workspaceId, exerciseId, imageId: image.id });

        expect(removed.storageKey).toBe('abc123.png');
    });

    it('refuses an image on an exercise in another workspace, and leaves it in place', async () => {
        const image = await guides.addImage({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: otherExerciseId,
            storageKey: 'theirs.png',
            contentType: 'image/png',
        });

        await expect(guides.removeImage({ userId, workspaceId, exerciseId, imageId: image.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );

        const detail = await exercises.get({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: otherExerciseId,
        });
        expect(detail.images.map((entry) => entry.id)).toContain(image.id);
    });
});
