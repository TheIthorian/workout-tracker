import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './timestamptz.js';
import { user } from './auth.js';
import { exercises } from './exercises.js';
import { workspaces } from './workspaces.js';

/**
 * A template for a workout: a name and an ordered list of exercises with targets. Starting a
 * session copies the list rather than referencing it, so a routine can be edited freely without
 * rewriting history — which is also why routines are archived, never deleted.
 */
export const routines = pgTable(
    'routines',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        createdByUserId: uuid('created_by_user_id'),
        name: text('name').notNull(),
        description: text('description'),
        archivedAt: timestamptz('archived_at'),
        excludedFromRecommendations: boolean('excluded_from_recommendations').default(false).notNull(),
        /**
         * Denormalised from workout history so the list can sort and page on it; null when the
         * routine is excluded, archived, or empty. Refreshed by the services, never written here.
         */
        recommendationScore: integer('recommendation_score'),
        /** When `recommendation_score` was last computed; null until it first has been. */
        recommendationScoredAt: timestamptz('recommendation_scored_at'),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamptz('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('routines_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        check(
            'routines_recommendation_score_check',
            sql`${table.recommendationScore} is null or ${table.recommendationScore} between 0 and 100`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'routines_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.createdByUserId],
            foreignColumns: [user.id],
            name: 'routines_created_by_user_id_user_id_fk',
        }).onDelete('set null'),
    ],
);

/**
 * One slot in a routine. The same exercise may appear more than once (drop sets, supersets), so
 * there is no uniqueness on `(routine_id, exercise_id)`. `position` is dense and 0-based, kept so by
 * the service rather than a unique index: a one-statement shift after a removal would violate a
 * non-deferrable index mid-update.
 *
 * Which `target_*` columns are meaningful follows the exercise's `tracking_type`; the service
 * rejects a mismatch, and everything is stored in canonical units (kg, m, s).
 */
export const routineExercises = pgTable(
    'routine_exercises',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        routineId: uuid('routine_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        position: integer('position').notNull(),
        targetSets: integer('target_sets').notNull(),
        restSeconds: integer('rest_seconds'),
        notes: text('notes'),
        targetReps: integer('target_reps'),
        targetWeightKg: numeric('target_weight_kg', { precision: 7, scale: 2, mode: 'number' }),
        targetDurationSeconds: integer('target_duration_seconds'),
        targetDistanceM: numeric('target_distance_m', { precision: 9, scale: 2, mode: 'number' }),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamptz('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('routine_exercises_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        index('routine_exercises_routine_id_idx').using('btree', table.routineId.asc().nullsLast().op('uuid_ops')),
        check('routine_exercises_target_sets_check', sql`${table.targetSets} >= 1`),
        check(
            'routine_exercises_targets_non_negative_check',
            sql`coalesce(${table.restSeconds}, 0) >= 0 and coalesce(${table.targetReps}, 0) >= 0 and coalesce(${table.targetWeightKg}, 0) >= 0 and coalesce(${table.targetDurationSeconds}, 0) >= 0 and coalesce(${table.targetDistanceM}, 0) >= 0`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'routine_exercises_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.routineId],
            foreignColumns: [routines.id],
            name: 'routine_exercises_routine_id_routines_id_fk',
        }).onDelete('cascade'),
        // Exercises are archived, never deleted; `restrict` makes a stray hard delete fail loudly
        // instead of silently emptying routines.
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'routine_exercises_exercise_id_exercises_id_fk',
        }).onDelete('restrict'),
    ],
);
