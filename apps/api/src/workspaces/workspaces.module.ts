import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller.js';
import { workspaceServiceProviders } from './workspaces.providers.js';

/** Wires the read-only internal workspace routes. */
@Module({
    controllers: [WorkspacesController],
    providers: [...workspaceServiceProviders],
})
export class WorkspacesModule {}
