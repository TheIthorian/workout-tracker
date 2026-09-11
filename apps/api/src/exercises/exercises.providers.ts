import { type Db } from '@app/db';
import { ExerciseGuideService, ExercisesService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `ExercisesService` factory provider below. */
export const EXERCISES_SERVICE = Symbol('EXERCISES_SERVICE');

/** DI token for the `ExerciseGuideService` factory provider below. */
export const EXERCISE_GUIDE_SERVICE = Symbol('EXERCISE_GUIDE_SERVICE');

/** Split out from `exercises.module.ts` to avoid a circular import between that module and its controllers. */
export const exerciseServiceProviders: Provider[] = [
    {
        provide: EXERCISES_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExercisesService =>
            new ExercisesService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
    {
        provide: EXERCISE_GUIDE_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseGuideService =>
            new ExerciseGuideService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
