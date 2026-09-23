import type { Db } from '@app/db';
import {
    WorkoutSessionsService,
    type RoutineRecommendationsService,
    type WorkspaceMembershipService,
} from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, ROUTINE_RECOMMENDATIONS_SERVICE, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

export const WORKOUT_SESSIONS_SERVICE = Symbol('WORKOUT_SESSIONS_SERVICE');
export const sessionServiceProviders: Provider[] = [
    {
        provide: WORKOUT_SESSIONS_SERVICE,
        useFactory: (
            db: Db,
            membership: WorkspaceMembershipService,
            recommendations: RoutineRecommendationsService,
        ): WorkoutSessionsService => new WorkoutSessionsService({ db, membership, recommendations }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE, ROUTINE_RECOMMENDATIONS_SERVICE],
    },
];
