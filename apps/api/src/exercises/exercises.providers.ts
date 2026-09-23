import { type Db } from '@app/db';
import {
    ExerciseGuideService,
    ExerciseImagesService,
    ExerciseHistoryService,
    ExerciseTargetsService,
    ExercisesService,
    type RoutineRecommendationsService,
    type WorkspaceMembershipService,
} from '@app/services';
import type { Provider } from '@nestjs/common';
import type { StorageService } from '@app/storage';
import { DB, STORAGE_SERVICE, ROUTINE_RECOMMENDATIONS_SERVICE, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for private exercise-image storage. */
export const EXERCISE_IMAGES_SERVICE = Symbol('EXERCISE_IMAGES_SERVICE');

/** DI token for the exercise library. */
export const EXERCISES_SERVICE = Symbol('EXERCISES_SERVICE');

/** DI token for the `ExerciseGuideService` factory provider below. */
export const EXERCISE_GUIDE_SERVICE = Symbol('EXERCISE_GUIDE_SERVICE');

/** DI token for completed-session exercise history. */
export const EXERCISE_HISTORY_SERVICE = Symbol('EXERCISE_HISTORY_SERVICE');

/** DI token for next-time targets and the suggestion built from them. */
export const EXERCISE_TARGETS_SERVICE = Symbol('EXERCISE_TARGETS_SERVICE');

/** Split out from `exercises.module.ts` to avoid a circular import between that module and its controllers. */
export const exerciseServiceProviders: Provider[] = [
    {
        provide: EXERCISE_IMAGES_SERVICE,
        useFactory: (guides: ExerciseGuideService, storage: StorageService): ExerciseImagesService =>
            new ExerciseImagesService({ guides, storage }),
        inject: [EXERCISE_GUIDE_SERVICE, STORAGE_SERVICE],
    },
    {
        provide: EXERCISES_SERVICE,
        useFactory: (
            db: Db,
            membership: WorkspaceMembershipService,
            recommendations: RoutineRecommendationsService,
        ): ExercisesService => new ExercisesService({ db, membership, recommendations }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE, ROUTINE_RECOMMENDATIONS_SERVICE],
    },
    {
        provide: EXERCISE_GUIDE_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseGuideService =>
            new ExerciseGuideService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
    {
        provide: EXERCISE_TARGETS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseTargetsService =>
            new ExerciseTargetsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
    {
        provide: EXERCISE_HISTORY_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseHistoryService =>
            new ExerciseHistoryService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
