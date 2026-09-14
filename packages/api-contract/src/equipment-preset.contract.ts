import { z } from 'zod';
import { equipmentListSchema } from './exercise.contract.js';
import { guidSchema } from './primitives.js';

const presetNameSchema = z.string().trim().min(1, 'Name is required').max(60, 'Name must not exceed 60 characters');

/** A named set of equipment a workspace can filter its library by. */
export const equipmentPresetResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    equipment: equipmentListSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The body of `GET /api/v1/workspaces/{workspaceId}/equipment-presets`. Unpaginated: a workspace keeps a handful. */
export const equipmentPresetListResponseSchema = z.object({
    data: z.array(equipmentPresetResponseSchema),
});

/** The body of `POST /api/v1/workspaces/{workspaceId}/equipment-presets`. */
export const postEquipmentPresetRequestSchema = z.object({
    name: presetNameSchema,
    equipment: equipmentListSchema.default([]),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/equipment-presets/{presetId}`. */
export const patchEquipmentPresetRequestSchema = z
    .object({
        name: presetNameSchema.optional(),
        equipment: equipmentListSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export type EquipmentPresetResponse = z.infer<typeof equipmentPresetResponseSchema>;
export type EquipmentPresetListResponse = z.infer<typeof equipmentPresetListResponseSchema>;
export type PostEquipmentPresetRequest = z.infer<typeof postEquipmentPresetRequestSchema>;
export type PatchEquipmentPresetRequest = z.infer<typeof patchEquipmentPresetRequestSchema>;
