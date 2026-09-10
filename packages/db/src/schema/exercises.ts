import { TrackingType } from '@app/domain';
import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { workspaces } from './workspaces.js';

export const trackingTypeEnum = pgEnum('tracking_type', [
    TrackingType.WeightReps,
    TrackingType.Duration,
    TrackingType.DistanceTime,
]);

/**
 * An exercise in the workspace's library, and its how-to guide.
 *
 * The `guide_*` fields sit here rather than in a one-to-one child table: they are a fixed, short
 * set read at a glance mid-workout, and a separate table would buy nothing but a join.
 *
 * Exercises are archived rather than deleted, because past sessions reference them and history
 * must not lose the name of what was trained.
 */
export const exercises = pgTable(
    'exercises',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        createdByUserId: uuid('created_by_user_id'),
        name: text('name').notNull(),
        trackingType: trackingTypeEnum('tracking_type').notNull(),
        notes: text('notes'),
        guideSetup: text('guide_setup'),
        guideExecution: text('guide_execution'),
        guideCues: text('guide_cues'),
        guideMistakes: text('guide_mistakes'),
        archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercises_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercises_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.createdByUserId],
            foreignColumns: [user.id],
            name: 'exercises_created_by_user_id_user_id_fk',
        }).onDelete('set null'),
    ],
);

/** An image belonging to an exercise's guide. The bytes live in object storage under `storage_key`. */
export const exerciseGuideImages = pgTable(
    'exercise_guide_images',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        storageKey: text('storage_key').notNull(),
        contentType: text('content_type').notNull(),
        caption: text('caption'),
        position: integer('position').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_guide_images_exercise_id_idx').using(
            'btree',
            table.exerciseId.asc().nullsLast().op('uuid_ops'),
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercise_guide_images_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'exercise_guide_images_exercise_id_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);

/** An external reference for an exercise, typically a video. */
export const exerciseLinks = pgTable(
    'exercise_links',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        url: text('url').notNull(),
        label: text('label'),
        position: integer('position').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_links_exercise_id_idx').using('btree', table.exerciseId.asc().nullsLast().op('uuid_ops')),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercise_links_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'exercise_links_exercise_id_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);
