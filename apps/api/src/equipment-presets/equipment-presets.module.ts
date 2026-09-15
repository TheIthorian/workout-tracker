import { Module } from '@nestjs/common';
import { EquipmentPresetsController } from './equipment-presets.controller.js';
import { equipmentPresetServiceProviders } from './equipment-presets.providers.js';

/** Wires `/api/v1/workspaces/:workspaceId/equipment-presets`. */
@Module({
    controllers: [EquipmentPresetsController],
    providers: [...equipmentPresetServiceProviders],
})
export class EquipmentPresetsModule {}
