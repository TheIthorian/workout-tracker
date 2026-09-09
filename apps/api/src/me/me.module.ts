import { Module } from '@nestjs/common';
import { McpAccessTokensController } from './mcp-access-tokens.controller.js';
import { MeController } from './me.controller.js';
import { meServiceProviders } from './me.providers.js';

/** Wires `GET/PATCH/DELETE /api/v1/me` and the three `/api/v1/me/mcp-access-tokens` routes. */
@Module({
    controllers: [MeController, McpAccessTokensController],
    providers: [...meServiceProviders],
})
export class MeModule {}
