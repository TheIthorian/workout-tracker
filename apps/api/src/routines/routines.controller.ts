import {
    guidSchema,
    patchRoutineRequestSchema,
    postRoutineRequestSchema,
    putRoutineExercisesRequestSchema,
    routineListQuerySchema,
    routineWebPath,
    type PatchRoutineRequest,
    type PostRoutineRequest,
    type PutRoutineExercisesRequest,
    type RoutineDetailResponse,
    type RoutineListQuery,
    type RoutineListResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionOrMcpBearerGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { RoutinesService } from '@app/services';
import { Controller, Get, HttpCode, Inject, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ROUTINES_SERVICE } from './routines.providers.js';

/**
 * Routines: the workspace's workout templates. Every route here is one an MCP tool calls, so the
 * class-level guard admits an MCP access token; the session-only slot routes live in
 * `RoutineExercisesController`.
 */
@Controller('v1/workspaces/:workspaceId/routines')
@UseGuards(SessionOrMcpBearerGuard)
export class RoutinesController {
    constructor(
        @Inject(ROUTINES_SERVICE) private readonly routines: RoutinesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** A page of the workspace's routines, by name. */
    @Get()
    async listRoutines(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(routineListQuerySchema) query: RoutineListQuery,
    ): Promise<RoutineListResponse> {
        return this.routines.list({
            userId: currentUser.userId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize,
            search: query.search,
            includeArchived: query.includeArchived,
        });
    }

    /** One routine with its ordered slots, plus the link to its editor in the web app. */
    @Get(':routineId')
    async getRoutine(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
    ): Promise<RoutineDetailResponse & { webUrl: string }> {
        const routine = await this.routines.get({ userId: currentUser.userId, workspaceId, routineId });

        return { ...routine, webUrl: this.urls.webAppUrl({ path: routineWebPath({ routineId }) }) };
    }

    /** Creates an empty routine. */
    @Post()
    @HttpCode(200)
    async createRoutine(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postRoutineRequestSchema) body: PostRoutineRequest,
    ): Promise<RoutineDetailResponse> {
        return this.routines.create({ userId: currentUser.userId, workspaceId, ...body });
    }

    /** Updates a routine's own fields. An omitted key leaves the stored value alone. */
    @Patch(':routineId')
    async patchRoutine(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
        @ValidatedBody(patchRoutineRequestSchema) body: PatchRoutineRequest,
    ): Promise<RoutineDetailResponse> {
        return this.routines.update({ userId: currentUser.userId, workspaceId, routineId, ...body });
    }

    /** Replaces the routine's whole slot list, in order. Also how a client reorders. */
    @Put(':routineId/exercises')
    async putExercises(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
        @ValidatedBody(putRoutineExercisesRequestSchema) body: PutRoutineExercisesRequest,
    ): Promise<RoutineDetailResponse> {
        return this.routines.replaceExercises({
            userId: currentUser.userId,
            workspaceId,
            routineId,
            exercises: body.exercises,
        });
    }
}
