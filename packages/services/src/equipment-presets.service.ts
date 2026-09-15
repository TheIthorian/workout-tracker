import { schema, scopedToWorkspace, type Db } from '@app/db';
import type { Equipment } from '@app/domain';
import { ConflictError, EntityNotFoundError } from '@app/errors';
import { asc, eq } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { equipmentPresets } = schema;

export type EquipmentPreset = {
    id: string;
    name: string;
    equipment: Equipment[];
    createdAt: string;
    updatedAt: string;
};

/** Named equipment sets a workspace filters its exercise library by. */
export class EquipmentPresetsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * Every preset in the workspace, by name.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<EquipmentPreset[]> {
        await this.membership.require({ userId, workspaceId });

        return this.db
            .select(PRESET_COLUMNS)
            .from(equipmentPresets)
            .where(scopedToWorkspace(equipmentPresets, workspaceId))
            .orderBy(asc(equipmentPresets.name));
    }

    /**
     * Creates a preset.
     *
     * @throws ConflictError when the workspace already has a preset with this name.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        equipment,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        equipment: Equipment[];
    }): Promise<EquipmentPreset> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(equipmentPresets)
            .values({ workspaceId, name, equipment })
            .onConflictDoNothing()
            .returning(PRESET_COLUMNS);

        if (!row) throw new ConflictError('A preset with this name already exists');

        return row;
    }

    /**
     * Updates a preset. Only the fields present are written.
     *
     * @throws ConflictError when the new name is already taken in the workspace.
     * @throws EntityNotFoundError when the caller is not a member, or the preset is not in this workspace.
     */
    async update({
        userId,
        workspaceId,
        presetId,
        name,
        equipment,
    }: {
        userId: string;
        workspaceId: string;
        presetId: string;
        name?: string;
        equipment?: Equipment[];
    }): Promise<EquipmentPreset> {
        await this.membership.require({ userId, workspaceId });

        if (name !== undefined) {
            const [taken] = await this.db
                .select({ id: equipmentPresets.id })
                .from(equipmentPresets)
                .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.name, name)));

            if (taken && taken.id !== presetId) throw new ConflictError('A preset with this name already exists');
        }

        const [row] = await this.db
            .update(equipmentPresets)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(equipment === undefined ? {} : { equipment }),
                updatedAt: new Date().toISOString(),
            })
            .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.id, presetId)))
            .returning(PRESET_COLUMNS);

        if (!row) throw new EntityNotFoundError('Equipment preset not found');

        return row;
    }

    /**
     * Deletes a preset.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the preset is not in this workspace.
     */
    async remove({
        userId,
        workspaceId,
        presetId,
    }: {
        userId: string;
        workspaceId: string;
        presetId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .delete(equipmentPresets)
            .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.id, presetId)))
            .returning({ id: equipmentPresets.id });

        if (!row) throw new EntityNotFoundError('Equipment preset not found');
    }
}

const PRESET_COLUMNS = {
    id: equipmentPresets.id,
    name: equipmentPresets.name,
    equipment: equipmentPresets.equipment,
    createdAt: equipmentPresets.createdAt,
    updatedAt: equipmentPresets.updatedAt,
};
