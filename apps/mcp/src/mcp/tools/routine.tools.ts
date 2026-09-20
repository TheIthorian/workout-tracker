import {
    createRoutineToolArgsSchema,
    getRoutineToolArgsSchema,
    listRoutinesToolArgsSchema,
    paginationQuerySchema,
    updateRoutineToolArgsSchema,
    type RoutineDetailResponse,
    type RoutineExerciseToolInput,
    type RoutineListResponse,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import { AppError } from '@app/errors';
import type { Logger } from '@app/logger';
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { runToolCaught, serializeToolResult } from '../tool-execution.js';
import { attachRoutineLinks } from './routine-links.js';

const TARGET_HELP =
    'Each slot names an exerciseId and optional targets: targetSets (default 3), restSeconds, notes, and ' +
    "the measurements that fit the exercise's trackingType — weight_reps: targetReps and targetWeightKg; " +
    'duration: targetDurationSeconds; distance_time: targetDistanceM and targetDurationSeconds. Units are ' +
    'kilograms, metres, and seconds. A target that does not fit the tracking type is rejected. The same ' +
    'exercise may appear more than once.';

/**
 * The workspace's routines, over the same `RoutineDetailResponse` wire shape `apps/api` serves.
 * A tool edits the exercise list by sending the whole ordered list, which `apps/api` applies as one
 * replacement — simpler for a model than diffing slot by slot.
 *
 * No tool here takes a `workspaceId`; it comes from the access token, same as every other
 * tool in this app.
 */
export function buildRoutineTools({
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
    const basePath = `/workspaces/${context.workspaceId}/routines`;

    const withLinks = <T extends { id: string }>(routine: T): T & { webUrl: string; resourceUrl: string } =>
        attachRoutineLinks({ urls, routine, workspaceId: context.workspaceId });

    const putExercises = async ({
        routineId,
        exercises,
    }: {
        routineId: string;
        exercises: RoutineExerciseToolInput[];
    }): Promise<RoutineDetailResponse> =>
        client.put<RoutineDetailResponse>({
            path: `${basePath}/${routineId}/exercises`,
            body: { exercises: exercises.map(toSlotBody) },
        });

    return [
        defineTool({
            methodName: 'ListRoutines',
            description:
                "Lists the user's routines (workout templates) by name, with optional search and " +
                'paging. Each entry carries exerciseCount and webUrl, the routine editor in the web app. ' +
                'Archived routines are excluded unless includeArchived is set.',
            inputSchema: listRoutinesToolArgsSchema,
            handler: async (args) => {
                const pagination = paginationQuerySchema.parse({
                    page: args.page ?? undefined,
                    pageSize: args.pageSize ?? undefined,
                });

                const page = await client.get<RoutineListResponse>({
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
            methodName: 'GetRoutine',
            description:
                'Gets a routine by id: its name, description, and ordered exercises, each with the exercise ' +
                '(id, name, trackingType, isCatalog, equipment, archivedAt) and its targets. An empty equipment ' +
                'list means the movement is bodyweight. Includes webUrl.',
            inputSchema: getRoutineToolArgsSchema,
            handler: async (args) => {
                const routine = await client.get<RoutineDetailResponse>({ path: `${basePath}/${args.routineId}` });

                return serializeToolResult({ body: withLinks(routine) });
            },
        }),
        defineTool({
            methodName: 'CreateRoutine',
            description:
                'Creates a routine, optionally with its complete ordered exercise ' +
                'list. Use list_exercises to find exerciseIds first. ' +
                TARGET_HELP +
                ' Returns the routine, including webUrl. If the exercise list is rejected, the routine is ' +
                'still created (empty) and returned as `routine` alongside the problem - fix the targets ' +
                'with update_routine rather than calling create_routine again.',
            inputSchema: createRoutineToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'create_routine',
                    logger,
                    action: async () => {
                        const created = await client.post<RoutineDetailResponse>({
                            path: basePath,
                            body: { name: args.name, description: normalizeDescription(args.description) },
                        });

                        if (args.exercises === undefined || args.exercises === null) {
                            return serializeToolResult({ body: withLinks(created) });
                        }

                        try {
                            const routine = await putExercises({ routineId: created.id, exercises: args.exercises });

                            return serializeToolResult({ body: withLinks(routine) });
                        } catch (error) {
                            if (!(error instanceof AppError)) throw error;

                            logger.warn(
                                { err: error, toolName: 'create_routine', routineId: created.id },
                                'Routine created but its exercise list was rejected.',
                            );

                            return serializeToolResult({ body: { ...error.problem, routine: withLinks(created) } });
                        }
                    },
                }),
        }),
        defineTool({
            methodName: 'UpdateRoutine',
            description:
                "Updates a routine's name or description, archives or restores it (archived true/false), " +
                'and/or replaces its whole exercise list. Omitted fields keep their stored value; pass an ' +
                'empty string for description to clear it. When exercises is given it REPLACES the list in ' +
                'the order given — send every slot you want to keep, so read the routine first. ' +
                TARGET_HELP,
            inputSchema: updateRoutineToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'update_routine',
                    logger,
                    action: async () => {
                        const patch = buildRoutinePatch(args);

                        let routine: RoutineDetailResponse | undefined;

                        if (Object.keys(patch).length > 0) {
                            routine = await client.patch<RoutineDetailResponse>({
                                path: `${basePath}/${args.routineId}`,
                                body: patch,
                            });
                        }

                        if (args.exercises !== undefined && args.exercises !== null) {
                            routine = await putExercises({ routineId: args.routineId, exercises: args.exercises });
                        }

                        routine ??= await client.get<RoutineDetailResponse>({ path: `${basePath}/${args.routineId}` });

                        return serializeToolResult({ body: withLinks(routine) });
                    },
                }),
        }),
    ];
}

/**
 * Builds the PATCH body from only the keys the caller actually sent, so an omitted field keeps its
 * stored value. An empty description clears it.
 */
function buildRoutinePatch(args: {
    name?: string | null;
    description?: string | null;
    archived?: boolean | null;
}): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined && args.name !== null) patch['name'] = args.name;
    if (args.description !== undefined && args.description !== null) {
        patch['description'] = normalizeDescription(args.description);
    }
    if (args.archived !== undefined && args.archived !== null) patch['archived'] = args.archived;

    return patch;
}

/** Drops nullish keys so the API's own defaults (targetSets 3) apply, rather than sending nulls. */
function toSlotBody(input: RoutineExerciseToolInput): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

/** Trims a description and turns an empty result into `null`; a missing one is `null` too. */
function normalizeDescription(description: string | null | undefined): string | null {
    if (description === undefined || description === null) return null;

    const trimmed = description.trim();

    return trimmed === '' ? null : trimmed;
}
