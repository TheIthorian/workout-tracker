import {
    addExerciseLinkToolArgsSchema,
    createExerciseToolArgsSchema,
    getExerciseToolArgsSchema,
    listExercisesToolArgsSchema,
    paginationQuerySchema,
    updateExerciseToolArgsSchema,
    type ExerciseDetailResponse,
    type ExerciseLinkResponse,
    type ExerciseListResponse,
    type UpdateExerciseToolArgs,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import type { Logger } from '@app/logger';
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { runToolCaught, serializeToolResult } from '../tool-execution.js';
import { attachExerciseLinks } from './exercise-links.js';

/**
 * The workspace's exercise library and each exercise's guide links, over the same
 * `ExerciseDetailResponse`/`ExerciseLinkResponse` wire shapes `apps/api` serves. Catalog exercises
 * (`isCatalog: true`) are shared, read-only content; the write tools answer 404 for a catalog id,
 * the same as for an exercise in another workspace. Guide images are catalog content served from a
 * CDN — there is no image tool.
 *
 * No tool here takes a `workspaceId`; it comes from the personal access token, same as every other
 * tool in this app.
 */
export function buildExerciseTools({
    context,
    client,
    logger,
    urls,
}: {
    context: McpContext;
    client: ApiClient;
    logger: Logger;
    urls: ResourceUrlGenerator;
}): McpToolDefinition[] {
    const basePath = `/workspaces/${context.workspaceId}/exercises`;

    const withLinks = <T extends { id: string }>(exercise: T): T & { webUrl: string; resourceUrl: string } =>
        attachExerciseLinks({ urls, exercise, workspaceId: context.workspaceId });

    return [
        defineTool({
            methodName: 'ListExercises',
            description:
                "Lists the exercises the token's workspace can see — the shared catalog plus its own " +
                'custom exercises — by name, with optional search and paging. isCatalog marks shared ' +
                'catalog exercises, which cannot be edited. Archived exercises are excluded unless ' +
                "includeArchived is set. Each exercise's trackingType (weight_reps, duration, or " +
                'distance_time) decides which fields a logged set for it carries. Each entry includes ' +
                'webUrl, the page for that exercise in the web app.',
            inputSchema: listExercisesToolArgsSchema,
            handler: async (args) => {
                const pagination = paginationQuerySchema.parse({
                    page: args.page ?? undefined,
                    pageSize: args.pageSize ?? undefined,
                });

                const page = await client.get<ExerciseListResponse>({
                    path: basePath,
                    query: {
                        page: pagination.page,
                        pageSize: pagination.pageSize,
                        search: args.search ?? undefined,
                        includeArchived: args.includeArchived ?? undefined,
                    },
                });

                return serializeToolResult({ body: { ...page, data: page.data.map(withLinks) } });
            },
        }),
        defineTool({
            methodName: 'GetExercise',
            description:
                'Gets an exercise by id, including its full guide (setup, execution, cues, common mistakes), ' +
                "images, and links. The exercise's trackingType (weight_reps, duration, or distance_time) " +
                'decides which fields a logged set for it carries. The response includes webUrl, the page for ' +
                'this exercise in the web app. Catalog exercises (isCatalog true) are read-only.',
            inputSchema: getExerciseToolArgsSchema,
            handler: async (args) => {
                const exercise = await client.get<ExerciseDetailResponse>({ path: `${basePath}/${args.exerciseId}` });

                return serializeToolResult({ body: withLinks(exercise) });
            },
        }),
        defineTool({
            methodName: 'CreateExercise',
            description:
                "Creates an exercise in the token's workspace. trackingType decides which fields a logged set " +
                'for this exercise must carry: weight_reps needs reps (and usually weightKg), duration needs ' +
                'durationSeconds, and distance_time needs both distanceM and durationSeconds - choose the type ' +
                'that matches how this exercise will actually be logged, not a guess. Returns the created ' +
                'exercise, including webUrl for its page in the web app.',
            inputSchema: createExerciseToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'create_exercise',
                    logger,
                    action: async () => {
                        const exercise = await client.post<ExerciseDetailResponse>({
                            path: basePath,
                            body: {
                                name: args.name,
                                trackingType: args.trackingType,
                                notes: args.notes ?? null,
                                guideSetup: args.guideSetup ?? null,
                                guideExecution: args.guideExecution ?? null,
                                guideCues: args.guideCues ?? null,
                                guideMistakes: args.guideMistakes ?? null,
                            },
                        });

                        return serializeToolResult({ body: withLinks(exercise) });
                    },
                }),
        }),
        defineTool({
            methodName: 'UpdateExercise',
            description:
                'Updates an exercise. Omitted fields keep their stored value; pass an empty string for a guide ' +
                'field to clear it. trackingType (weight_reps, duration, or distance_time) decides which fields ' +
                'a logged set for this exercise carries, so only change it if the exercise is genuinely tracked ' +
                'differently now. Set archived to true or false to archive or restore the exercise. Not ' +
                'applicable to catalog exercises, which answer not-found.',
            inputSchema: updateExerciseToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'update_exercise',
                    logger,
                    action: async () => {
                        const exercise = await client.patch<ExerciseDetailResponse>({
                            path: `${basePath}/${args.exerciseId}`,
                            body: buildExercisePatch(args),
                        });

                        return serializeToolResult({ body: withLinks(exercise) });
                    },
                }),
        }),
        defineTool({
            methodName: 'AddExerciseLink',
            description:
                "Appends an external link (for example, a demonstration video) to an exercise's guide. This " +
                "exercise's trackingType (weight_reps, duration, or distance_time) is unaffected by this tool " +
                'and still decides which fields a logged set for it carries. Not applicable to catalog ' +
                'exercises, which answer not-found.',
            inputSchema: addExerciseLinkToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'add_exercise_link',
                    logger,
                    action: async () => {
                        const link = await client.post<ExerciseLinkResponse>({
                            path: `${basePath}/${args.exerciseId}/links`,
                            body: { url: args.url, label: args.label ?? null },
                        });

                        return serializeToolResult({ body: link });
                    },
                }),
        }),
    ];
}

/**
 * Builds the PATCH body from only the keys the caller actually sent, so an omitted field keeps its
 * stored value rather than being overwritten with null.
 *
 * An empty or whitespace-only guide field is the one way to clear it - the alternative would be a
 * caller with no way to remove guide text at all.
 */
function buildExercisePatch(args: UpdateExerciseToolArgs): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined) patch['name'] = args.name;
    if (args.trackingType !== undefined) patch['trackingType'] = args.trackingType;

    for (const field of ['notes', 'guideSetup', 'guideExecution', 'guideCues', 'guideMistakes'] as const) {
        const value = args[field];
        if (value === undefined || value === null) continue;

        patch[field] = value.trim() === '' ? null : value;
    }

    if (args.archived !== undefined && args.archived !== null) patch['archived'] = args.archived;

    return patch;
}
