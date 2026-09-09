import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller.js';
import { workspaceServiceProviders } from './workspaces.providers.js';

/** Wires the `/api/v1/workspaces` routes and their member sub-routes. */
@Module({
    controllers: [WorkspacesController],
    providers: [...workspaceServiceProviders],
})
export class WorkspacesModule {}
