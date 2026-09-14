import { patchUserRequestSchema, type PatchUserRequest, type UserResponse } from '@app/api-contract';
import type { AuthService } from '@app/auth';
import type { UsersService } from '@app/services';
import {
    CurrentUser,
    McpPatAuthGuard,
    McpSession,
    SessionAuthGuard,
    SessionOrMcpPatGuard,
    ValidatedBody,
    type CurrentUserContext,
    type McpContext,
} from '@app/nest-common';
import { Controller, Delete, Get, Inject, Patch, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AUTH_SERVICE } from '../providers.js';
import { USERS_SERVICE } from './me.providers.js';

/**
 * The signed-in user's own profile.
 *
 * No class-level guard, deliberately: Nest ANDs a class-level guard with any method-level one
 * rather than letting the method loosen it, so a class default of `SessionAuthGuard` would make
 * `getMe` below unreachable by a token even with `@UseGuards(SessionOrMcpPatGuard)` added - that
 * guard would still run and pass, but so would the inherited `SessionAuthGuard`, and a token-only
 * request has no session to satisfy it. Every route below states its own guard explicitly instead.
 */
@Controller('v1/me')
export class MeController {
    constructor(
        @Inject(USERS_SERVICE) private readonly usersService: UsersService,
        @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    ) {}

    /**
     * Resolves the MCP personal access token presented on this request to the identity and
     * workspace it is scoped to. `apps/mcp` calls this once when a connection opens: it rejects an
     * invalid token before the MCP transport is created, and supplies the workspace id every tool
     * path needs.
     *
     * Guarded by `McpPatAuthGuard` alone: a browser session has no token to resolve. This is the
     * one route on the controller that must be reachable by a PAT and ONLY a PAT.
     *
     * Declared ahead of any future `:param` route on this controller — a literal segment must
     * always be registered before a route that could capture it.
     */
    @Get('mcp-session')
    @UseGuards(McpPatAuthGuard)
    async mcpSession(@McpSession() session: McpContext): Promise<{ userId: string; workspaceId: string }> {
        return { userId: session.userId, workspaceId: session.workspaceId };
    }

    /**
     * Returns the current user's profile and every workspace they belong to. `apps/mcp`'s
     * `get_current_user` tool reaches this with a personal access token instead of a browser
     * session.
     */
    @Get()
    @UseGuards(SessionOrMcpPatGuard)
    async getMe(@CurrentUser() currentUser: CurrentUserContext): Promise<UserResponse> {
        return this.usersService.getUser(currentUser.userId);
    }

    /** Sets the display name and returns the updated profile. Session-only: no MCP tool calls this. */
    @Patch()
    @UseGuards(SessionAuthGuard)
    async patchMe(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedBody(patchUserRequestSchema) body: PatchUserRequest,
    ): Promise<UserResponse> {
        return this.usersService.updateDisplayName({ userId: currentUser.userId, displayName: body.displayName });
    }

    /**
     * Deletes the account and its personal data, then signs the caller out. Session-only,
     * deliberately: account deletion is irreversible and must not be reachable by a leaked token.
     */
    @Delete()
    @UseGuards(SessionAuthGuard)
    async deleteMe(
        @CurrentUser() currentUser: CurrentUserContext,
        @Req() request: FastifyRequest,
    ): Promise<{ message: string }> {
        await this.usersService.deleteUser(currentUser.userId);
        await this.authService.logout({ cookieHeader: request.headers.cookie });

        return { message: 'Account deleted successfully' };
    }
}
