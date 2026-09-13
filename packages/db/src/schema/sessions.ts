import { SessionExerciseSource } from '@app/domain';
import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    foreignKey,
    index,
    integer,
    numeric,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { exercises, trackingTypeEnum } from './exercises.js';
import { routines } from './routines.js';
import { workspaces } from './workspaces.js';

export const sessionExerciseSourceEnum = pgEnum('session_exercise_source', [
    SessionExerciseSource.FromRoutine,
    SessionExerciseSource.AddedAdHoc,
]);

export const workoutSessions = pgTable(
    'workout_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        userId: uuid('user_id'),
        routineId: uuid('routine_id'),
        name: text('name').notNull(),
        startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
        notes: text('notes'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('workout_sessions_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('workout_sessions_active_uidx')
            .on(table.workspaceId)
            .where(sql`${table.completedAt} is null`),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'workout_sessions_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'workout_sessions_user_id_user_id_fk',
        }).onDelete('set null'),
        foreignKey({
            columns: [table.routineId],
            foreignColumns: [routines.id],
            name: 'workout_sessions_routine_id_routines_id_fk',
        }).onDelete('set null'),
    ],
);

export const sessionExercises = pgTable(
    'session_exercises',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        sessionId: uuid('session_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        trackingType: trackingTypeEnum('tracking_type').notNull(),
        source: sessionExerciseSourceEnum('source').notNull(),
        position: integer('position').notNull(),
        targetSets: integer('target_sets').notNull(),
        restSeconds: integer('rest_seconds'),
        notes: text('notes'),
        skippedAt: timestamp('skipped_at', { withTimezone: true, mode: 'string' }),
        targetReps: integer('target_reps'),
        targetWeightKg: numeric('target_weight_kg', { precision: 7, scale: 2, mode: 'number' }),
        targetDurationSeconds: integer('target_duration_seconds'),
        targetDistanceM: numeric('target_distance_m', { precision: 9, scale: 2, mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('session_exercises_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        index('session_exercises_session_id_idx').using('btree', table.sessionId.asc().nullsLast().op('uuid_ops')),
        index('session_exercises_exercise_id_idx').using('btree', table.exerciseId.asc().nullsLast().op('uuid_ops')),
        check('session_exercises_target_sets_check', sql`${table.targetSets} >= 1`),
        check(
            'session_exercises_targets_non_negative_check',
            sql`coalesce(${table.restSeconds}, 0) >= 0 and coalesce(${table.targetReps}, 0) >= 0 and coalesce(${table.targetWeightKg}, 0) >= 0 and coalesce(${table.targetDurationSeconds}, 0) >= 0 and coalesce(${table.targetDistanceM}, 0) >= 0`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'session_exercises_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.sessionId],
            foreignColumns: [workoutSessions.id],
            name: 'session_exercises_session_id_workout_sessions_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'session_exercises_exercise_id_exercises_id_fk',
        }).onDelete('restrict'),
    ],
);

export const setEntries = pgTable(
    'set_entries',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        sessionExerciseId: uuid('session_exercise_id').notNull(),
        setIndex: integer('set_index').notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        isWarmup: boolean('is_warmup').default(false).notNull(),
        rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
        weightKg: numeric('weight_kg', { precision: 7, scale: 2, mode: 'number' }),
        reps: integer('reps'),
        durationSeconds: integer('duration_seconds'),
        distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('set_entries_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('set_entries_session_exercise_id_set_index_uidx').on(table.sessionExerciseId, table.setIndex),
        check('set_entries_set_index_check', sql`${table.setIndex} >= 1`),
        check('set_entries_rpe_check', sql`${table.rpe} is null or (${table.rpe} >= 0 and ${table.rpe} <= 10)`),
        check(
            'set_entries_measurements_non_negative_check',
            sql`coalesce(${table.weightKg}, 0) >= 0 and coalesce(${table.reps}, 0) >= 0 and coalesce(${table.durationSeconds}, 0) >= 0 and coalesce(${table.distanceM}, 0) >= 0`,
        ),
        check(
            'set_entries_measurement_present_check',
            sql`${table.reps} is not null or ${table.durationSeconds} is not null`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'set_entries_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.sessionExerciseId],
            foreignColumns: [sessionExercises.id],
            name: 'set_entries_session_exercise_id_session_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);
