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
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { serializeToolResult } from '../tool-execution.js';
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
 * No tool here takes a `workspaceId`; it comes from the personal access token, same as every other
 * tool in this app - see `item.tools.ts`'s doc comment for why.
 *
 * Unlike `item.tools.ts` and `exercise.tools.ts`, `create_routine` and `update_routine` do not use
 * `runToolCaught`. Each is a two-step write - create or patch the routine, then replace its exercise
 * list - so a failure in the second step happens after the first has already committed. Swallowing
 * that into a soft, retry-friendly problem body would invite the model to resend the same arguments
 * and create a duplicate routine; surfacing it as `isError: true` instead is the same treatment
 * `get_item`/`delete_item` give a failure the model cannot safely paper over.
 */
export function buildRoutineTools({
    context,
    client,
    urls,
}: {
    context: McpContext;
    client: ApiClient;
    urls: ResourceUrlGenerator;
}): McpToolDefinition[] {
    const basePath = `/workspaces/${context.workspaceId}/routines`;

    const withLinks = <T extends { id: string }>(routine: T): T & { webUrl: string; resourceUrl: string } =>
        attachRoutineLinks({ urls, routine, workspaceId: context.workspaceId });

    const putExercises = async (
        routineId: string,
        exercises: RoutineExerciseToolInput[],
    ): Promise<RoutineDetailResponse> =>
        client.put<RoutineDetailResponse>({
            path: `${basePath}/${routineId}/exercises`,
            body: { exercises: exercises.map(toSlotBody) },
        });

    return [
        defineTool({
            methodName: 'ListRoutines',
            description:
                "Lists the token's workspace routines (workout templates) by name, with optional search and " +
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
                '(id, name, trackingType, isCatalog, archivedAt) and its targets. Includes webUrl.',
            inputSchema: getRoutineToolArgsSchema,
            handler: async (args) => {
                const routine = await client.get<RoutineDetailResponse>({ path: `${basePath}/${args.routineId}` });

                return serializeToolResult({ body: withLinks(routine) });
            },
        }),
        defineTool({
            methodName: 'CreateRoutine',
            description:
                "Creates a routine in the token's workspace, optionally with its complete ordered exercise " +
                'list. Use list_exercises to find exerciseIds first. ' +
                TARGET_HELP +
                ' Returns the routine, including webUrl.',
            inputSchema: createRoutineToolArgsSchema,
            handler: async (args) => {
                const created = await client.post<RoutineDetailResponse>({
                    path: basePath,
                    body: { name: args.name, description: args.description ?? null },
                });

                const routine =
                    args.exercises === undefined || args.exercises === null
                        ? created
                        : await putExercises(created.id, args.exercises);

                return serializeToolResult({ body: withLinks(routine) });
            },
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
            handler: async (args) => {
                const patch = buildRoutinePatch(args);

                let routine: RoutineDetailResponse | undefined;

                if (Object.keys(patch).length > 0) {
                    routine = await client.patch<RoutineDetailResponse>({
                        path: `${basePath}/${args.routineId}`,
                        body: patch,
                    });
                }

                if (args.exercises !== undefined && args.exercises !== null) {
                    routine = await putExercises(args.routineId, args.exercises);
                }

                routine ??= await client.get<RoutineDetailResponse>({ path: `${basePath}/${args.routineId}` });

                return serializeToolResult({ body: withLinks(routine) });
            },
        }),
    ];
}

/**
 * Builds the PATCH body from only the keys the caller actually sent, so an omitted field keeps its
 * stored value. An empty description clears it, the same convention `item.tools.ts` uses.
 */
function buildRoutinePatch(args: {
    name?: string | null;
    description?: string | null;
    archived?: boolean | null;
}): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined && args.name !== null) patch['name'] = args.name;
    if (args.description !== undefined && args.description !== null) {
        patch['description'] = args.description.trim() === '' ? null : args.description;
    }
    if (args.archived !== undefined && args.archived !== null) patch['archived'] = args.archived;

    return patch;
}

/** Drops nullish keys so the API's own defaults (targetSets 3) apply, rather than sending nulls. */
function toSlotBody(input: RoutineExerciseToolInput): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}
