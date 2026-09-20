import {
    completeSessionRequestSchema,
    guidSchema,
    postSessionRequestSchema,
    postSetRequestSchema,
    sessionListQuerySchema,
    sessionWebPath,
    type ActiveSessionResponse,
    type CompleteSessionRequest,
    type PostSessionRequest,
    type PostSetRequest,
    type SessionDetailResponse,
    type SessionListQuery,
    type SessionListResponse,
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
import type { WorkoutSessionsService } from '@app/services';
import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { WORKOUT_SESSIONS_SERVICE } from './sessions.providers.js';

/** MCP-reachable workout session routes. */
@Controller('v1/workspaces/:workspaceId/sessions')
@UseGuards(SessionOrMcpBearerGuard)
export class SessionsController {
    constructor(
        @Inject(WORKOUT_SESSIONS_SERVICE) private readonly sessions: WorkoutSessionsService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** Lists session summaries. */
    @Get()
    async listSessions(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(sessionListQuerySchema) query: SessionListQuery,
    ): Promise<SessionListResponse> {
        return this.sessions.list({ userId: user.userId, workspaceId, page: query.page, pageSize: query.pageSize });
    }

    /** Gets the active session if there is one. */
    @Get('active')
    async getActiveSession(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<ActiveSessionResponse> {
        return { session: await this.sessions.getActive({ userId: user.userId, workspaceId }) };
    }

    /** Gets one session with its state. */
    @Get(':sessionId')
    async getSession(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
    ): Promise<SessionDetailResponse & { webUrl: string }> {
        const session = await this.sessions.get({ userId: user.userId, workspaceId, sessionId });
        return { ...session, webUrl: this.urls.webAppUrl({ path: sessionWebPath({ sessionId }) }) };
    }

    /** Starts a blank session or snapshots a routine. */
    @Post()
    @HttpCode(200)
    async startSession(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postSessionRequestSchema) body: PostSessionRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.start({ userId: user.userId, workspaceId, ...body });
    }

    /** Completes a session. */
    @Post(':sessionId/complete')
    @HttpCode(200)
    async completeSession(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(completeSessionRequestSchema) body: CompleteSessionRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.complete({ userId: user.userId, workspaceId, sessionId, ...body });
    }

    /** Logs a set. */
    @Post(':sessionId/exercises/:sessionExerciseId/sets')
    @HttpCode(200)
    async logSet(
        @CurrentUser() user: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedBody(postSetRequestSchema) body: PostSetRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.logSet({ userId: user.userId, workspaceId, sessionId, sessionExerciseId, ...body });
    }
}
