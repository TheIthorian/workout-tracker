import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `onboarding-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';
    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });
    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { workspaces: { workspaceId: string }[] };
    return { cookie, workspaceId: body.workspaces[0]?.workspaceId as string };
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('onboarding route', () => {
    it('reports the stage on /me and updates it', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const before = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        expect(
            (JSON.parse(before.body) as { workspaces: { onboardingStage: string }[] }).workspaces[0]?.onboardingStage,
        ).toBe('equipment');

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'complete' },
        });
        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toEqual({ stage: 'complete' });

        const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        expect(
            (JSON.parse(after.body) as { workspaces: { onboardingStage: string }[] }).workspaces[0]?.onboardingStage,
        ).toBe('complete');
    });

    it('rejects an unknown stage and a foreign workspace', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const other = await signUpUser();

        const bad = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'done' },
        });
        expect(bad.statusCode).toBe(400);

        const foreign = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${other.workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'complete' },
        });
        expect(foreign.statusCode).toBe(404);
    });
});
