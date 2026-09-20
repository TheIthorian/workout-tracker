import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './timestamptz.js';
import { equipmentEnum } from './exercises.js';
import { workspaces } from './workspaces.js';

/**
 * A named set of equipment a workspace can filter its exercise library by — "Home", "Gym". Which
 * preset is active is a per-device choice kept in the browser, not a column here.
 */
export const equipmentPresets = pgTable(
    'equipment_presets',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        name: text('name').notNull(),
        equipment: equipmentEnum('equipment')
            .array()
            .notNull()
            .default(sql`'{}'::equipment[]`),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamptz('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('equipment_presets_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('equipment_presets_workspace_id_name_uidx').on(table.workspaceId, table.name),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'equipment_presets_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
    ],
);
