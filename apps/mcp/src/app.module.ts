import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { InfrastructureModule } from './infrastructure.module.js';
import { McpModule } from './mcp/mcp.module.js';

/**
 * The application's root module. `apps/mcp` serves exactly one route - the MCP endpoint - so this
 * is deliberately tiny: everything else it needs comes from the same `packages/*` the REST API
 * composes, not from a second copy of the business logic.
 */
@Module({
    imports: [InfrastructureModule, McpModule],
    controllers: [HealthController],
})
export class AppModule {}
