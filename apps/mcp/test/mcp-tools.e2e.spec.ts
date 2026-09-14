import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TrackingType } from '@app/domain';
import {
    connectedClient,
    createTestApp,
    seedExercise,
    seedMcpToken,
    seedRoutine,
    seedUser,
    seedWorkspace,
    TEST_WEB_APP_BASE_URL,
    toolResultBody,
    type TestApp,
} from './harness.js';

describe('MCP tools', () => {
    let app: TestApp;
    let userId: string;
    let workspaceId: string;
    let client: Client;

    beforeAll(async () => {
        app = await createTestApp();

        const user = await seedUser(app.db, { email: 'tools@example.com', displayName: 'Tools' });
        userId = user.id;

        const workspace = await seedWorkspace(app.db, { name: 'Home', ownerId: userId });
        workspaceId = workspace.id;

        client = await connectedClient(app, { token: await seedMcpToken(app.db, { userId, workspaceId }) });
    });

    afterAll(async () => {
        await client?.close();
        await app?.close();
    });

    it('sends server instructions describing token-scoped user data', () => {
        expect(client.getInstructions()).toContain('The MCP URL token determines which user data');
    });

    it('calls get_current_user through the real transport and gets the real user back', async () => {
        const result = await client.callTool({ name: 'get_current_user', arguments: {} });

        expect(toolResultBody(result)).toEqual({ userId, email: 'tools@example.com', displayName: 'Tools' });
    });

    it('rejects an unrecognised argument rather than ignoring it', async () => {
        const result = await client.callTool({ name: 'get_current_user', arguments: { workspaceId } });

        expect(result.isError).toBe(true);
    });

    it('rejects a request whose path token does not validate, before any tool runs', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/mcp/not-a-real-token',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        });

        expect(response.statusCode).toBe(401);
    });

    describe('exercise tools', () => {
        it('creates an exercise and returns it with both links attached', async () => {
            const result = await client.callTool({
                name: 'create_exercise',
                arguments: { name: 'Back Squat', trackingType: 'weight_reps' },
            });

            expect(toolResultBody(result)).toMatchObject({
                name: 'Back Squat',
                trackingType: 'weight_reps',
                webUrl: expect.stringContaining(`${TEST_WEB_APP_BASE_URL}/exercises/`),
            });
        });

        it('lists the workspace exercises with links on every entry', async () => {
            await seedExercise(app.db, { userId, workspaceId, name: 'Listed Exercise' });

            const body = toolResultBody(await client.callTool({ name: 'list_exercises', arguments: {} })) as {
                data: { name: string; webUrl: string }[];
            };

            expect(body.data.map((exercise) => exercise.name)).toContain('Listed Exercise');
            expect(body.data.every((exercise) => exercise.webUrl.startsWith(TEST_WEB_APP_BASE_URL))).toBe(true);
        });

        it('reads one exercise back by id, including its tracking type', async () => {
            const { id } = await seedExercise(app.db, { userId, workspaceId, name: 'Readable Exercise' });

            const result = await client.callTool({ name: 'get_exercise', arguments: { exerciseId: id } });

            expect(toolResultBody(result)).toMatchObject({
                id,
                name: 'Readable Exercise',
                trackingType: 'weight_reps',
            });
        });

        // An omitted field keeps its stored value; the model must be able to rename without also
        // having to resend a tracking type it never saw.
        it('updates only the fields it is given', async () => {
            const { id } = await seedExercise(app.db, { userId, workspaceId, name: 'Before Exercise' });

            const result = await client.callTool({
                name: 'update_exercise',
                arguments: { exerciseId: id, name: 'After Exercise' },
            });

            expect(toolResultBody(result)).toMatchObject({ id, name: 'After Exercise' });
        });

        it('appends a link to an exercise guide', async () => {
            const { id } = await seedExercise(app.db, { userId, workspaceId, name: 'Linked Exercise' });

            const result = await client.callTool({
                name: 'add_exercise_link',
                arguments: { exerciseId: id, url: 'https://example.com/demo' },
            });

            expect(toolResultBody(result)).toMatchObject({ url: 'https://example.com/demo' });
        });

        // The pin is the point: a token issued for one workspace must not read another's rows even
        // though its owner is a member of both.
        it('cannot reach an exercise in another workspace the same user owns', async () => {
            const other = await seedWorkspace(app.db, { name: 'Other Exercises', ownerId: userId });
            const { id } = await seedExercise(app.db, { userId, workspaceId: other.id, name: 'Elsewhere Exercise' });

            const result = await client.callTool({ name: 'get_exercise', arguments: { exerciseId: id } });

            expect(result.isError).toBe(true);
        });
    });

    describe('routine tools', () => {
        it('creates a routine with an exercise list and returns it with both links attached', async () => {
            const { id: benchId } = await seedExercise(app.db, { userId, workspaceId, name: 'Bench' });

            const result = await client.callTool({
                name: 'create_routine',
                arguments: {
                    name: 'Push Day',
                    exercises: [{ exerciseId: benchId, targetSets: 4, targetReps: 8, targetWeightKg: 60 }],
                },
            });

            expect(result.isError).toBeFalsy();
            expect(toolResultBody(result)).toMatchObject({
                name: 'Push Day',
                exerciseCount: 1,
                exercises: [{ position: 0, targetSets: 4, targetReps: 8, exercise: { id: benchId, name: 'Bench' } }],
                webUrl: expect.stringContaining(`${TEST_WEB_APP_BASE_URL}/routines/`),
            });
        });

        it('lists routines with links on every entry', async () => {
            await client.callTool({ name: 'create_routine', arguments: { name: 'Listed Routine' } });

            const body = toolResultBody(await client.callTool({ name: 'list_routines', arguments: {} })) as {
                data: { name: string; webUrl: string }[];
            };

            expect(body.data.map((routine) => routine.name)).toContain('Listed Routine');
            expect(body.data.every((routine) => routine.webUrl.startsWith(TEST_WEB_APP_BASE_URL))).toBe(true);
        });

        it('reads one routine back and replaces its exercise list on update', async () => {
            const { id: plankId } = await seedExercise(app.db, {
                userId,
                workspaceId,
                name: 'Plank',
                trackingType: TrackingType.Duration,
            });
            const created = toolResultBody(
                await client.callTool({ name: 'create_routine', arguments: { name: 'Core' } }),
            ) as { id: string };

            const fetched = await client.callTool({ name: 'get_routine', arguments: { routineId: created.id } });
            expect(toolResultBody(fetched)).toMatchObject({ id: created.id, name: 'Core', exercises: [] });

            const updated = await client.callTool({
                name: 'update_routine',
                arguments: {
                    routineId: created.id,
                    name: 'Core Day',
                    exercises: [{ exerciseId: plankId, targetDurationSeconds: 60 }],
                },
            });
            expect(toolResultBody(updated)).toMatchObject({
                name: 'Core Day',
                exercises: [{ targetSets: 3, targetDurationSeconds: 60, exercise: { name: 'Plank' } }],
            });
        });

        it('returns a tracking-type mismatch as a problem body the model can act on', async () => {
            const { id: plankId } = await seedExercise(app.db, {
                userId,
                workspaceId,
                name: 'Plank Two',
                trackingType: TrackingType.Duration,
            });

            const result = await client.callTool({
                name: 'create_routine',
                arguments: { name: 'Bad', exercises: [{ exerciseId: plankId, targetReps: 8 }] },
            });

            expect(result.isError).toBeFalsy();
            const body = toolResultBody(result) as { routine: { id: string } };
            expect(body).toMatchObject({
                status: 400,
                type: expect.stringMatching(/SetShapeMismatchError$/),
                routine: { id: expect.any(String) },
            });

            const fetched = await client.callTool({
                name: 'get_routine',
                arguments: { routineId: body.routine.id },
            });
            expect(toolResultBody(fetched)).toMatchObject({ id: body.routine.id, exercises: [] });
        });

        // The pin is the point: a token issued for one workspace must not read another's rows even
        // though its owner is a member of both.
        it('cannot reach a routine in another workspace the same user owns', async () => {
            const other = await seedWorkspace(app.db, { name: 'Other Routines', ownerId: userId });
            const { id } = await seedRoutine(app.db, { userId, workspaceId: other.id, name: 'Elsewhere Routine' });

            const result = await client.callTool({ name: 'get_routine', arguments: { routineId: id } });

            expect(result.isError).toBe(true);
        });
    });
});
