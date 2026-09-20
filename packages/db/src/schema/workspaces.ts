import { OnboardingStage } from '@app/domain';
import { sql } from 'drizzle-orm';
import { foreignKey, index, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './timestamptz.js';
import { user } from './auth.js';

/**
 * A member's role within one workspace. Ordered least to most privileged; `WorkspaceRole` in
 * `@app/api-contract` mirrors this list and the two must stay in step.
 */
export const workspaceRole = pgEnum('workspace_role', ['member', 'admin', 'owner']);

/** Mirrors `OnboardingStage` in `@app/domain`; the two must stay in step. */
export const onboardingStageEnum = pgEnum('onboarding_stage', [OnboardingStage.Equipment, OnboardingStage.Complete]);

/** The unit of multi-tenancy. Nearly every application row belongs to exactly one of these. */
export const workspaces = pgTable('workspaces', {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    name: text('name').notNull(),
    onboardingStage: onboardingStageEnum('onboarding_stage').default(OnboardingStage.Equipment).notNull(),
    createdAt: timestamptz('created_at')
        .default(sql`now()`)
        .notNull(),
    updatedAt: timestamptz('updated_at')
        .default(sql`now()`)
        .notNull(),
});

/**
 * Which users belong to which workspace, and in what role. The composite primary key is what makes
 * a duplicate membership impossible at the database level rather than only in application code.
 */
export const workspaceUsers = pgTable(
    'workspace_users',
    {
        workspaceId: uuid('workspace_id').notNull(),
        userId: uuid('user_id').notNull(),
        role: workspaceRole('role').default('member').notNull(),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.workspaceId, table.userId], name: 'workspace_users_pkey' }),
        index('workspace_users_user_id_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'workspace_users_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'workspace_users_user_id_user_id_fk',
        }).onDelete('cascade'),
    ],
);
