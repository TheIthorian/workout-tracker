import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller.js';
import { itemServiceProviders } from './items.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/items` routes. */
@Module({
    controllers: [ItemsController],
    providers: [...itemServiceProviders],
})
export class ItemsModule {}
