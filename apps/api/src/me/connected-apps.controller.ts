import { disconnectAppQuerySchema, type ConnectedAppResponse, type DisconnectAppQuery } from '@app/api-contract';
import { CurrentUser, SessionAuthGuard, ValidatedQuery, type CurrentUserContext } from '@app/nest-common';
import type { ConnectedAppsService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, UseGuards } from '@nestjs/common';
import { CONNECTED_APPS_SERVICE } from '../oauth/oauth.providers.js';

/**
 * The MCP clients a user has connected, and the control they have over them.
 *
 * `clientId` is a query parameter rather than a path segment because it is an https URL: a path
 * segment carrying one would have to be double-encoded to survive routing, and every client of this
 * endpoint would have to know that.
 */
@Controller('v1/me/connected-apps')
@UseGuards(SessionAuthGuard)
export class ConnectedAppsController {
    constructor(@Inject(CONNECTED_APPS_SERVICE) private readonly connectedApps: ConnectedAppsService) {}

    /** Every app the user has connected and not disconnected. */
    @Get()
    async list(@CurrentUser() currentUser: CurrentUserContext): Promise<ConnectedAppResponse[]> {
        return this.connectedApps.list({ userId: currentUser.userId });
    }

    /** Disconnects an app: its grant and every token issued under it stop working at once. */
    @Delete()
    @HttpCode(204)
    async disconnect(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedQuery(disconnectAppQuerySchema) query: DisconnectAppQuery,
    ): Promise<void> {
        await this.connectedApps.disconnect({ userId: currentUser.userId, clientId: query.clientId });
    }
}
