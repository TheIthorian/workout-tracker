// Generates an OpenAPI 3.1 document from the `@app/api-contract` Zod schemas — the single source
// of truth for the REST wire format. Run: `node scripts/generate-openapi.mjs > openapi.json`.
//
// There is no @nestjs/swagger in this repo; the contract package is where request/response shapes
// live, so the document is assembled from those schemas plus the route table read off the
// controllers. Query parameters that use Zod transforms are described by hand (a transform is not
// representable as JSON Schema), everything else is converted with Zod 4's `z.toJSONSchema`.

import { z } from '../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js';
import * as C from '../packages/api-contract/dist/index.js';

const VERSION = '1.0.0';

// --- component schemas -------------------------------------------------------------------------
// name -> the contract schema to convert. Only plain object schemas (no transforms) belong here.
const componentSources = {
    // requests
    LoginRequest: C.loginRequestSchema,
    SignupRequest: C.signupRequestSchema,
    PostWorkspaceRequest: C.postWorkspaceRequestSchema,
    PatchWorkspaceRequest: C.patchWorkspaceRequestSchema,
    PostWorkspaceUserRequest: C.postWorkspaceUserRequestSchema,
    PatchWorkspaceUserRoleRequest: C.patchWorkspaceUserRoleRequestSchema,
    PatchUserRequest: C.patchUserRequestSchema,
    PostItemRequest: C.postItemRequestSchema,
    PatchItemRequest: C.patchItemRequestSchema,
    PostExerciseRequest: C.postExerciseRequestSchema,
    PatchExerciseRequest: C.patchExerciseRequestSchema,
    PostExerciseLinkRequest: C.postExerciseLinkRequestSchema,
    PatchExerciseLinkRequest: C.patchExerciseLinkRequestSchema,
    PostMcpAccessTokenRequest: C.postMcpAccessTokenRequestSchema,

    // responses
    UserResponse: C.userResponseSchema,
    WorkspaceResponse: C.workspaceResponseSchema,
    WorkspaceListItem: C.workspaceListItemSchema,
    MemberListItem: C.memberListItemSchema,
    ItemResponse: C.itemResponseSchema,
    ItemListResponse: C.itemListResponseSchema,
    ExerciseResponse: C.exerciseResponseSchema,
    ExerciseDetailResponse: C.exerciseDetailResponseSchema,
    ExerciseListResponse: C.exerciseListResponseSchema,
    ExerciseGuideImageResponse: C.exerciseGuideImageResponseSchema,
    ExerciseLinkResponse: C.exerciseLinkResponseSchema,
    McpAccessTokenCreatedResponse: C.mcpAccessTokenCreatedResponseSchema,
    McpAccessTokenListItemResponse: C.mcpAccessTokenListItemResponseSchema,
};

const schemas = {};
for (const [name, schema] of Object.entries(componentSources)) {
    // draft-2020-12 (Zod's default) is what OpenAPI 3.1 embeds. Keep every ref pointing at the
    // shared components section rather than inlining.
    schemas[name] = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
    delete schemas[name].$schema;
}

// The two detail GETs return their resource plus a `webUrl` the API adds for client convenience.
schemas.ItemDetailResponse = withWebUrl('ItemResponse');
schemas.ExerciseDetailWithUrlResponse = withWebUrl('ExerciseDetailResponse');

// RFC 7807 problem details — every error response body, produced by `@app/errors`.
schemas.ProblemDetails = {
    type: 'object',
    description: 'RFC 7807 problem details. `type` is `${PROBLEM_TYPE_BASE}/${errorName}`.',
    properties: {
        type: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string' },
    },
    required: ['type', 'title', 'status'],
};

function withWebUrl(baseName) {
    return {
        allOf: [{ $ref: `#/components/schemas/${baseName}` }],
        type: 'object',
        properties: { webUrl: { type: 'string', format: 'uri' } },
        required: ['webUrl'],
    };
}

// --- reusable pieces ---------------------------------------------------------------------------
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
const jsonResponse = (name, description) => ({
    description,
    content: { 'application/json': { schema: ref(name) } },
});
const arrayResponse = (name, description) => ({
    description,
    content: { 'application/json': { schema: { type: 'array', items: ref(name) } } },
});
const noContent = { description: 'No content.' };

const problem = (description) => ({ description, content: { 'application/problem+json': { schema: ref('ProblemDetails') } } });
const commonErrors = {
    400: problem('Validation failed.'),
    401: problem('Not authenticated.'),
    403: problem('Authenticated but not permitted.'),
    404: problem('No such resource (also returned for a workspace the caller may not see).'),
};

const workspaceIdParam = {
    name: 'workspaceId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
};
const pathUuid = (name) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });

// Pagination + list query params (Zod transforms, described by hand).
const paginationParams = [
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
    { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    { name: 'orderBy', in: 'query', schema: { type: 'string' } },
    { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
];

const sessionAuth = [{ sessionCookie: [] }];
const patAuth = [{ mcpBearer: [] }];
const eitherAuth = [{ sessionCookie: [] }, { mcpBearer: [] }];

// --- paths -------------------------------------------------------------------------------------
const paths = {
    '/api/v1/auth/login': {
        post: op({
            tags: ['Auth'],
            summary: 'Sign in with email and password; sets the session cookie.',
            security: [],
            requestBody: jsonBody('LoginRequest'),
            responses: { 204: noContent, 400: commonErrors[400], 401: problem('Invalid credentials or locked out.') },
        }),
    },
    '/api/v1/auth/signup': {
        post: op({
            tags: ['Auth'],
            summary: 'Create an account and its default workspace; sets the session cookie.',
            security: [],
            requestBody: jsonBody('SignupRequest'),
            responses: { 204: noContent, 400: commonErrors[400] },
        }),
    },
    '/api/v1/auth/logout': {
        post: op({ tags: ['Auth'], summary: 'Clear the session cookie.', security: sessionAuth, responses: { 204: noContent } }),
    },

    '/api/v1/me': {
        get: op({ tags: ['Me'], summary: 'The signed-in user and their workspaces.', security: eitherAuth, responses: { 200: jsonResponse('UserResponse', 'The current user.'), ...pick(commonErrors, 401) } }),
        patch: op({ tags: ['Me'], summary: 'Update the current user (display name).', security: sessionAuth, requestBody: jsonBody('PatchUserRequest'), responses: { 200: jsonResponse('UserResponse', 'The updated user.'), ...pick(commonErrors, 400, 401) } }),
        delete: op({ tags: ['Me'], summary: 'Delete the current account.', security: sessionAuth, responses: { 200: jsonResponse('MessageResponse', 'Deletion acknowledged.'), ...pick(commonErrors, 401) } }),
    },
    '/api/v1/me/mcp-session': {
        get: op({ tags: ['Me'], summary: 'Resolve the workspace an MCP token is pinned to.', security: patAuth, responses: { 200: jsonResponse('McpSessionResponse', 'The token session.'), ...pick(commonErrors, 401) } }),
    },
    '/api/v1/me/mcp-access-tokens': {
        get: op({ tags: ['MCP tokens'], summary: 'List the caller’s MCP access tokens.', security: sessionAuth, responses: { 200: arrayResponse('McpAccessTokenListItemResponse', 'The caller’s tokens.'), ...pick(commonErrors, 401) } }),
        post: op({ tags: ['MCP tokens'], summary: 'Create an MCP access token (plaintext returned once).', security: sessionAuth, requestBody: jsonBody('PostMcpAccessTokenRequest'), responses: { 200: jsonResponse('McpAccessTokenCreatedResponse', 'The created token.'), ...pick(commonErrors, 400, 401, 404) } }),
    },
    '/api/v1/me/mcp-access-tokens/{tokenId}': {
        parameters: [pathUuid('tokenId')],
        delete: op({ tags: ['MCP tokens'], summary: 'Revoke an MCP access token.', security: sessionAuth, responses: { 204: noContent, ...pick(commonErrors, 401, 404) } }),
    },

    '/api/v1/workspaces': {
        get: op({ tags: ['Workspaces'], summary: 'Every workspace the caller belongs to.', security: eitherAuth, responses: { 200: arrayResponse('WorkspaceListItem', 'The caller’s workspaces.'), ...pick(commonErrors, 401) } }),
        post: op({ tags: ['Workspaces'], summary: 'Create a workspace (caller becomes owner).', security: sessionAuth, requestBody: jsonBody('PostWorkspaceRequest'), responses: { 200: jsonResponse('WorkspaceResponse', 'The created workspace.'), ...pick(commonErrors, 400, 401) } }),
    },
    '/api/v1/workspaces/{workspaceId}': {
        parameters: [workspaceIdParam],
        get: op({ tags: ['Workspaces'], summary: 'One workspace with its members.', security: eitherAuth, responses: { 200: jsonResponse('WorkspaceResponse', 'The workspace.'), ...pick(commonErrors, 401, 404) } }),
        patch: op({ tags: ['Workspaces'], summary: 'Rename a workspace (admin+).', security: sessionAuth, requestBody: jsonBody('PatchWorkspaceRequest'), responses: { 200: jsonResponse('WorkspaceResponse', 'The renamed workspace.'), ...pick(commonErrors, 400, 401, 403, 404) } }),
        delete: op({ tags: ['Workspaces'], summary: 'Delete a workspace and its contents (owner).', security: sessionAuth, responses: { 204: noContent, ...pick(commonErrors, 401, 403, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/members': {
        parameters: [workspaceIdParam],
        get: op({ tags: ['Workspaces'], summary: 'Every member of the workspace.', security: sessionAuth, responses: { 200: arrayResponse('MemberListItem', 'The members.'), ...pick(commonErrors, 401, 403, 404) } }),
        post: op({ tags: ['Workspaces'], summary: 'Add an existing user by email (admin+).', security: sessionAuth, requestBody: jsonBody('PostWorkspaceUserRequest'), responses: { 200: arrayResponse('MemberListItem', 'The updated member list.'), ...pick(commonErrors, 400, 401, 403, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/members/{memberUserId}': {
        parameters: [workspaceIdParam, pathUuid('memberUserId')],
        patch: op({ tags: ['Workspaces'], summary: 'Change a member’s role (admin+).', security: sessionAuth, requestBody: jsonBody('PatchWorkspaceUserRoleRequest'), responses: { 200: arrayResponse('MemberListItem', 'The updated member list.'), ...pick(commonErrors, 400, 401, 403, 404) } }),
        delete: op({ tags: ['Workspaces'], summary: 'Remove a member (admin+).', security: sessionAuth, responses: { 200: arrayResponse('MemberListItem', 'The updated member list.'), ...pick(commonErrors, 401, 403, 404) } }),
    },

    '/api/v1/workspaces/{workspaceId}/items': {
        parameters: [workspaceIdParam],
        get: op({ tags: ['Items'], summary: 'List items in the workspace.', security: eitherAuth, parameters: paginationParams, responses: { 200: jsonResponse('ItemListResponse', 'A page of items.'), ...pick(commonErrors, 401, 404) } }),
        post: op({ tags: ['Items'], summary: 'Create an item.', security: eitherAuth, requestBody: jsonBody('PostItemRequest'), responses: { 200: jsonResponse('ItemResponse', 'The created item.'), ...pick(commonErrors, 400, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/items/{itemId}': {
        parameters: [workspaceIdParam, pathUuid('itemId')],
        get: op({ tags: ['Items'], summary: 'One item.', security: eitherAuth, responses: { 200: jsonResponse('ItemDetailResponse', 'The item, with its web URL.'), ...pick(commonErrors, 401, 404) } }),
        patch: op({ tags: ['Items'], summary: 'Update an item.', security: eitherAuth, requestBody: jsonBody('PatchItemRequest'), responses: { 200: jsonResponse('ItemResponse', 'The updated item.'), ...pick(commonErrors, 400, 401, 404) } }),
        delete: op({ tags: ['Items'], summary: 'Delete an item.', security: eitherAuth, responses: { 204: noContent, ...pick(commonErrors, 401, 404) } }),
    },

    '/api/v1/workspaces/{workspaceId}/exercises': {
        parameters: [workspaceIdParam],
        get: op({ tags: ['Exercises'], summary: 'List exercises in the workspace.', security: eitherAuth, parameters: [...paginationParams, { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } }, { name: 'includeArchived', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }], responses: { 200: jsonResponse('ExerciseListResponse', 'A page of exercises.'), ...pick(commonErrors, 401, 404) } }),
        post: op({ tags: ['Exercises'], summary: 'Create an exercise.', security: eitherAuth, requestBody: jsonBody('PostExerciseRequest'), responses: { 200: jsonResponse('ExerciseDetailResponse', 'The created exercise.'), ...pick(commonErrors, 400, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}': {
        parameters: [workspaceIdParam, pathUuid('exerciseId')],
        get: op({ tags: ['Exercises'], summary: 'One exercise with its guide, images and links.', security: eitherAuth, responses: { 200: jsonResponse('ExerciseDetailWithUrlResponse', 'The exercise, with its web URL.'), ...pick(commonErrors, 401, 404) } }),
        patch: op({ tags: ['Exercises'], summary: 'Update an exercise or archive it.', security: eitherAuth, requestBody: jsonBody('PatchExerciseRequest'), responses: { 200: jsonResponse('ExerciseDetailResponse', 'The updated exercise.'), ...pick(commonErrors, 400, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/links': {
        parameters: [workspaceIdParam, pathUuid('exerciseId')],
        post: op({ tags: ['Exercises'], summary: 'Add a reference link to an exercise.', security: eitherAuth, requestBody: jsonBody('PostExerciseLinkRequest'), responses: { 200: jsonResponse('ExerciseLinkResponse', 'The created link.'), ...pick(commonErrors, 400, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/links/{linkId}': {
        parameters: [workspaceIdParam, pathUuid('exerciseId'), pathUuid('linkId')],
        patch: op({ tags: ['Exercises'], summary: 'Update a link (url, label, or position).', security: sessionAuth, requestBody: jsonBody('PatchExerciseLinkRequest'), responses: { 200: jsonResponse('ExerciseLinkResponse', 'The updated link.'), ...pick(commonErrors, 400, 401, 404) } }),
        delete: op({ tags: ['Exercises'], summary: 'Remove a link.', security: sessionAuth, responses: { 204: noContent, ...pick(commonErrors, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/images': {
        parameters: [workspaceIdParam, pathUuid('exerciseId')],
        post: op({
            tags: ['Exercises'],
            summary: 'Upload a guide image (png/jpeg/webp) with an optional caption.',
            security: sessionAuth,
            requestBody: {
                required: true,
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            properties: {
                                file: { type: 'string', format: 'binary' },
                                caption: { type: 'string', maxLength: 200 },
                            },
                            required: ['file'],
                        },
                    },
                },
            },
            responses: { 200: jsonResponse('ExerciseGuideImageResponse', 'The uploaded image.'), ...pick(commonErrors, 400, 401, 404) },
        }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/images/{imageId}': {
        parameters: [workspaceIdParam, pathUuid('exerciseId'), pathUuid('imageId')],
        delete: op({ tags: ['Exercises'], summary: 'Remove a guide image.', security: sessionAuth, responses: { 204: noContent, ...pick(commonErrors, 401, 404) } }),
    },
    '/api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/images/{imageId}/content': {
        parameters: [workspaceIdParam, pathUuid('exerciseId'), pathUuid('imageId')],
        get: op({
            tags: ['Exercises'],
            summary: 'Stream a guide image’s bytes.',
            security: eitherAuth,
            responses: { 200: { description: 'The image bytes.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } }, ...pick(commonErrors, 401, 404) },
        }),
    },

    '/api/health': {
        get: op({ tags: ['Health'], summary: 'Liveness probe.', security: [], responses: { 200: { description: 'The service is up.' } } }),
    },
    '/api/health/ready': {
        get: op({ tags: ['Health'], summary: 'Readiness probe (checks dependencies).', security: [], responses: { 200: { description: 'Ready.' }, 503: problem('Not ready.') } }),
    },
};

// Small ad-hoc response schemas the controllers return inline.
schemas.MessageResponse = { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] };
schemas.McpSessionResponse = {
    type: 'object',
    properties: { userId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' } },
    required: ['userId', 'workspaceId'],
};

function op(o) {
    return o;
}
function pick(source, ...codes) {
    const out = {};
    for (const code of codes) out[code] = source[code];
    return out;
}

const doc = {
    openapi: '3.1.0',
    info: {
        title: 'Workout Tracker API',
        version: VERSION,
        description:
            'REST API for the workout tracker. Generated from the `@app/api-contract` Zod schemas — the single source of truth for the wire format. Errors are RFC 7807 problem details.',
    },
    servers: [{ url: '/', description: 'Same-origin (the API mounts every route under /api).' }],
    tags: [
        { name: 'Auth' },
        { name: 'Me' },
        { name: 'MCP tokens' },
        { name: 'Workspaces' },
        { name: 'Exercises' },
        { name: 'Items', description: 'Template example resource — copy its shape, then delete it.' },
        { name: 'Health' },
    ],
    components: {
        securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session', description: 'Better Auth session cookie (browser client).' },
            mcpBearer: { type: 'http', scheme: 'bearer', description: 'MCP personal access token, pinned to one workspace.' },
        },
        schemas,
    },
    paths,
};

process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
