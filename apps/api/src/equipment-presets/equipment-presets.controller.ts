import {
    guidSchema,
    patchEquipmentPresetRequestSchema,
    postEquipmentPresetRequestSchema,
    type EquipmentPresetListResponse,
    type EquipmentPresetResponse,
    type PatchEquipmentPresetRequest,
    type PostEquipmentPresetRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { EquipmentPresetsService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { EQUIPMENT_PRESETS_SERVICE } from './equipment-presets.providers.js';

/** Named equipment sets the workspace filters its exercise library by. */
@Controller('v1/workspaces/:workspaceId/equipment-presets')
@UseGuards(SessionAuthGuard)
export class EquipmentPresetsController {
    constructor(@Inject(EQUIPMENT_PRESETS_SERVICE) private readonly presets: EquipmentPresetsService) {}

    /** Every preset in the workspace, by name. */
    @Get()
    async listPresets(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<EquipmentPresetListResponse> {
        return { data: await this.presets.list({ userId: currentUser.userId, workspaceId }) };
    }

    /** Creates a preset. */
    @Post()
    @HttpCode(201)
    async createPreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postEquipmentPresetRequestSchema) body: PostEquipmentPresetRequest,
    ): Promise<EquipmentPresetResponse> {
        return this.presets.create({ userId: currentUser.userId, workspaceId, ...body });
    }

    /** Updates a preset. An omitted key leaves the stored value alone. */
    @Patch(':presetId')
    async patchPreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'presetId', schema: guidSchema }) presetId: string,
        @ValidatedBody(patchEquipmentPresetRequestSchema) body: PatchEquipmentPresetRequest,
    ): Promise<EquipmentPresetResponse> {
        return this.presets.update({ userId: currentUser.userId, workspaceId, presetId, ...body });
    }

    /** Deletes a preset. */
    @Delete(':presetId')
    @HttpCode(204)
    async deletePreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'presetId', schema: guidSchema }) presetId: string,
    ): Promise<void> {
        await this.presets.remove({ userId: currentUser.userId, workspaceId, presetId });
    }
}
