import {
    addExerciseLinkToolArgsSchema,
    clearExerciseTargetToolArgsSchema,
    createExerciseToolArgsSchema,
    getExerciseSuggestionToolArgsSchema,
    getExerciseToolArgsSchema,
    listExercisesToolArgsSchema,
    paginationQuerySchema,
    setExerciseTargetToolArgsSchema,
    updateExerciseToolArgsSchema,
    type ExerciseDetailResponse,
    type ExerciseLinkResponse,
    type ExerciseListResponse,
    type ExerciseSuggestionResponse,
    type ExerciseTargetResponse,
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
                'Lists the exercises the user can see — the shared catalog plus their own ' +
                'custom exercises — by name, with optional search and paging. isCatalog marks shared ' +
                'catalog exercises, which cannot be edited. Archived exercises are excluded unless ' +
                "includeArchived is set. Each exercise's trackingType (weight_reps, duration, or " +
                'distance_time) decides which fields a logged set for it carries. Each entry includes ' +
                'webUrl, the page for that exercise in the web app. Pass equipment to keep only exercises ' +
                "that need nothing beyond it; an empty list means bodyweight only. Each exercise's equipment " +
                'lists what it requires. Pass muscle to keep only exercises that work it, whether as a primary ' +
                'or a secondary target.',
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
                        equipment: args.equipment == null ? undefined : args.equipment.join(','),
                        muscle: args.muscle ?? undefined,
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
                'Creates an exercise. trackingType decides which fields a logged set ' +
                'for this exercise must carry: weight_reps needs reps (and usually weightKg), duration needs ' +
                'durationSeconds, and distance_time needs both distanceM and durationSeconds - choose the type ' +
                'that matches how this exercise will actually be logged, not a guess. primaryMuscles are what ' +
                'the movement is for and secondaryMuscles what it also works; both feed the muscle heatmap. ' +
                'Returns the created ' +
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
                                equipment: args.equipment ?? undefined,
                                primaryMuscles: args.primaryMuscles ?? undefined,
                                secondaryMuscles: args.secondaryMuscles ?? undefined,
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
                'differently now. primaryMuscles and secondaryMuscles each replace the stored list outright. ' +
                'Set archived to true or false to archive or restore the exercise. Not ' +
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
            methodName: 'GetExerciseSuggestion',
            description:
                'Suggests what to open the next session with for an exercise, and says why. source is ' +
                'target when a target was set that has not been trained through yet, last_performance ' +
                'when it is built from the last working set (raised when that set came in at a low RPE), ' +
                'or baseline when the exercise has never been logged and there is nothing to go on. ' +
                'isFirstAttempt marks that last case. message is the line the app shows the user. Only ' +
                "the fields the exercise's trackingType allows are filled in.",
            inputSchema: getExerciseSuggestionToolArgsSchema,
            handler: async (args) => {
                const suggestion = await client.get<ExerciseSuggestionResponse>({
                    path: `${basePath}/${args.exerciseId}/suggestion`,
                });

                return serializeToolResult({ body: suggestion });
            },
        }),
        defineTool({
            methodName: 'SetExerciseTarget',
            description:
                'Sets what the user should aim for the next time they train an exercise, which the app ' +
                'offers them when they start logging it. Give only the fields that match the ' +
                "exercise's trackingType: weightKg and reps for weight_reps, durationSeconds for " +
                'duration, distanceM and durationSeconds for distance_time. This replaces the whole ' +
                'target, so a field left out is cleared rather than kept. note is shown to the user in ' +
                "place of the app's own wording, so write it as coaching addressed to them. A target is " +
                'used once: after the exercise is trained again the app goes back to suggesting from ' +
                'history, so set a new one to steer the session after that.',
            inputSchema: setExerciseTargetToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'set_exercise_target',
                    logger,
                    action: async () => {
                        const target = await client.put<ExerciseTargetResponse>({
                            path: `${basePath}/${args.exerciseId}/target`,
                            body: {
                                weightKg: args.weightKg ?? null,
                                reps: args.reps ?? null,
                                durationSeconds: args.durationSeconds ?? null,
                                distanceM: args.distanceM ?? null,
                                note: args.note ?? null,
                            },
                        });

                        return serializeToolResult({ body: target });
                    },
                }),
        }),
        defineTool({
            methodName: 'ClearExerciseTarget',
            description:
                'Removes the target for an exercise, so the app goes back to suggesting from what the ' +
                'user last did. Succeeds whether or not a target was set.',
            inputSchema: clearExerciseTargetToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'clear_exercise_target',
                    logger,
                    action: async () => {
                        await client.delete_({ path: `${basePath}/${args.exerciseId}/target` });

                        return serializeToolResult({ body: { exerciseId: args.exerciseId, target: null } });
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
    if (args.equipment !== undefined && args.equipment !== null) patch['equipment'] = args.equipment;
    if (args.primaryMuscles !== undefined && args.primaryMuscles !== null)
        patch['primaryMuscles'] = args.primaryMuscles;
    if (args.secondaryMuscles !== undefined && args.secondaryMuscles !== null)
        patch['secondaryMuscles'] = args.secondaryMuscles;

    for (const field of ['notes', 'guideSetup', 'guideExecution', 'guideCues', 'guideMistakes'] as const) {
        const value = args[field];
        if (value === undefined || value === null) continue;

        patch[field] = value.trim() === '' ? null : value;
    }

    if (args.archived !== undefined && args.archived !== null) patch['archived'] = args.archived;

    return patch;
}
