import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure.module.js';
import { McpController } from './mcp.controller.js';
import { mcpProviders } from './mcp.providers.js';

/**
 * The MCP tool surface: one route, and the per-request tool factory behind it. No guard - the
 * controller resolves the token's session itself, over HTTP against `apps/api`.
 */
@Module({
    imports: [InfrastructureModule],
    controllers: [McpController],
    providers: [...mcpProviders],
})
export class McpModule {}
