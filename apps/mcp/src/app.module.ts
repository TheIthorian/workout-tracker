import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { InfrastructureModule } from './infrastructure.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { ProtectedResourceController } from './well-known/protected-resource.controller.js';

/**
 * The application's root module. `apps/mcp` serves the MCP endpoint, the OAuth protected-resource
 * metadata that points a client at the authorization server, and health probes - so this is
 * deliberately tiny: everything else it needs comes from the same `packages/*` the REST API
 * composes, not from a second copy of the business logic.
 */
@Module({
    imports: [InfrastructureModule, McpModule],
    controllers: [HealthController, ProtectedResourceController],
})
export class AppModule {}
