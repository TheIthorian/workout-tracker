import { describe, expect, it } from 'vitest';
import { loginRequestSchema, signupRequestSchema } from './auth.contract.js';
import { clientIdMetadataSchema, oauthAuthorizeQuerySchema } from './oauth.contract.js';
import { patchUserRequestSchema, userResponseSchema } from './user.contract.js';
import { WorkspaceRole, workspaceResponseSchema } from './workspace.contract.js';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('auth contracts', () => {
    it('requires an email and a password on login', () => {
        expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: 'hunter22' }).success).toBe(true);
        expect(loginRequestSchema.safeParse({ email: 'nope', password: 'hunter22' }).success).toBe(false);
    });

    it('accepts signup without a display name', () => {
        expect(signupRequestSchema.parse({ email: 'a@b.com', password: 'hunter22' }).displayName).toBeUndefined();
    });

    it('accepts an explicit null display name', () => {
        expect(
            signupRequestSchema.safeParse({ email: 'a@b.com', password: 'hunter22', displayName: null }).success,
        ).toBe(true);
    });

    // Must stay in step with MIN_PASSWORD_LENGTH in UserProvisioningService.
    it('rejects a password shorter than 8 characters', () => {
        expect(signupRequestSchema.safeParse({ email: 'a@b.com', password: 'hunter2' }).success).toBe(false);
    });
});

describe('user contracts', () => {
    it('requires a display name of at most 100 characters', () => {
        expect(patchUserRequestSchema.safeParse({ displayName: '' }).success).toBe(false);
        expect(patchUserRequestSchema.safeParse({ displayName: 'x'.repeat(101) }).success).toBe(false);
        expect(patchUserRequestSchema.safeParse({ displayName: 'Ada' }).success).toBe(true);
    });

    it('describes the /me response, workspaces included', () => {
        expect(
            userResponseSchema.safeParse({
                userId: GUID,
                displayName: 'Ada',
                email: 'a@b.com',
                workspaces: [
                    { workspaceId: GUID, name: 'Acme', role: WorkspaceRole.Owner, onboardingStage: 'equipment' },
                ],
            }).success,
        ).toBe(true);
    });
});

describe('workspace contracts', () => {
    it('describes the workspace response', () => {
        expect(
            workspaceResponseSchema.safeParse({
                workspaceId: GUID,
                name: 'Acme',
                role: WorkspaceRole.Owner,
                members: [{ userId: GUID, displayName: 'Ada', email: 'a@b.com', role: WorkspaceRole.Owner }],
            }).success,
        ).toBe(true);
    });
});

describe('oauth contracts', () => {
    it('accepts an authorization request with every parameter missing, so the flow can answer with an OAuth error', () => {
        expect(oauthAuthorizeQuerySchema.safeParse({}).success).toBe(true);
    });

    it('requires a metadata document to name its own client_id and at least one redirect_uri', () => {
        expect(
            clientIdMetadataSchema.safeParse({
                client_id: 'https://client.example/oauth-client',
                redirect_uris: ['https://client.example/callback'],
            }).success,
        ).toBe(true);
        expect(clientIdMetadataSchema.safeParse({ client_id: 'https://client.example/oauth-client' }).success).toBe(
            false,
        );
        expect(
            clientIdMetadataSchema.safeParse({
                client_id: 'https://client.example/oauth-client',
                redirect_uris: [],
            }).success,
        ).toBe(false);
    });

    it('strips members a client publishes for other authorization servers', () => {
        const parsed = clientIdMetadataSchema.parse({
            client_id: 'https://client.example/oauth-client',
            redirect_uris: ['https://client.example/callback'],
            jwks_uri: 'https://client.example/jwks.json',
        });

        expect(parsed).not.toHaveProperty('jwks_uri');
    });
});
