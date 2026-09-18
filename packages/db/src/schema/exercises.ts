import { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { sql } from 'drizzle-orm';
import {
    check,
    foreignKey,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { workspaces } from './workspaces.js';

export const trackingTypeEnum = pgEnum('tracking_type', [
    TrackingType.WeightReps,
    TrackingType.Duration,
    TrackingType.DistanceTime,
]);

export const equipmentEnum = pgEnum('equipment', [
    Equipment.Barbell,
    Equipment.Dumbbell,
    Equipment.Kettlebell,
    Equipment.Cable,
    Equipment.Machine,
    Equipment.SquatRack,
    Equipment.Bench,
    Equipment.PullUpBar,
    Equipment.ResistanceBand,
    Equipment.Treadmill,
    Equipment.StationaryBike,
    Equipment.RowingMachine,
]);

export const muscleGroupEnum = pgEnum('muscle_group', [
    MuscleGroup.Chest,
    MuscleGroup.FrontDelts,
    MuscleGroup.SideDelts,
    MuscleGroup.RearDelts,
    MuscleGroup.Biceps,
    MuscleGroup.Triceps,
    MuscleGroup.Forearms,
    MuscleGroup.Abs,
    MuscleGroup.Obliques,
    MuscleGroup.Lats,
    MuscleGroup.UpperBack,
    MuscleGroup.Traps,
    MuscleGroup.LowerBack,
    MuscleGroup.Glutes,
    MuscleGroup.Quads,
    MuscleGroup.Hamstrings,
    MuscleGroup.Calves,
    MuscleGroup.Adductors,
    MuscleGroup.Abductors,
]);

/**
 * The exercise library: catalog exercises shared by every workspace, and each workspace's own
 * custom ones. `workspace_id IS NULL` marks a catalog row; `slug` is the seed's stable key for it.
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
        workspaceId: uuid('workspace_id'),
        slug: text('slug'),
        createdByUserId: uuid('created_by_user_id'),
        name: text('name').notNull(),
        trackingType: trackingTypeEnum('tracking_type').notNull(),
        equipment: equipmentEnum('equipment')
            .array()
            .notNull()
            .default(sql`'{}'::equipment[]`),
        notes: text('notes'),
        primaryMuscles: muscleGroupEnum('primary_muscles')
            .array()
            .notNull()
            .default(sql`'{}'::muscle_group[]`),
        secondaryMuscles: muscleGroupEnum('secondary_muscles')
            .array()
            .notNull()
            .default(sql`'{}'::muscle_group[]`),
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
        uniqueIndex('exercises_catalog_slug_uidx')
            .on(table.slug)
            .where(sql`${table.workspaceId} is null`),
        // A catalog row always has a slug and a custom row never does, so the two kinds cannot blur.
        check('exercises_catalog_slug_check', sql`(${table.workspaceId} is null) = (${table.slug} is not null)`),
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

/**
 * An image belonging to an exercise's guide. The bytes live in object storage under `storage_key`.
 * `workspace_id` mirrors the parent exercise's, null included, so the same scoping helper reads both.
 */
export const exerciseGuideImages = pgTable(
    'exercise_guide_images',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id'),
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
        index('exercise_guide_images_workspace_id_idx').using(
            'btree',
            table.workspaceId.asc().nullsLast().op('uuid_ops'),
        ),
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

/**
 * An external reference for an exercise, typically a video.
 * `workspace_id` mirrors the parent exercise's, null included, so the same scoping helper reads both.
 */
export const exerciseLinks = pgTable(
    'exercise_links',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id'),
        exerciseId: uuid('exercise_id').notNull(),
        url: text('url').notNull(),
        label: text('label'),
        position: integer('position').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_links_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
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

/**
 * A workspace's own settings for an exercise it trains — catalog or custom. Kept off `exercises`
 * because a catalog row is shared, read-only content and every workspace needs its own rest time.
 */
export const exercisePreferences = pgTable(
    'exercise_preferences',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        restSeconds: integer('rest_seconds').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_preferences_workspace_id_idx').using(
            'btree',
            table.workspaceId.asc().nullsLast().op('uuid_ops'),
        ),
        uniqueIndex('exercise_preferences_workspace_id_exercise_id_uidx').on(table.workspaceId, table.exerciseId),
        check('exercise_preferences_rest_seconds_check', sql`${table.restSeconds} >= 0`),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercise_preferences_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'exercise_preferences_exercise_id_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);
