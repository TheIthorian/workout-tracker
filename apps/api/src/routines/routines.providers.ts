import { type Db } from '@app/db';
import { RoutinesService, type RoutineRecommendationsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, ROUTINE_RECOMMENDATIONS_SERVICE, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `RoutinesService` factory provider below. */
export const ROUTINES_SERVICE = Symbol('ROUTINES_SERVICE');

/** Split out from `routines.module.ts` to avoid a circular import between that module and its controllers. */
export const routineServiceProviders: Provider[] = [
    {
        provide: ROUTINES_SERVICE,
        useFactory: (
            db: Db,
            membership: WorkspaceMembershipService,
            recommendations: RoutineRecommendationsService,
        ): RoutinesService => new RoutinesService({ db, membership, recommendations }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE, ROUTINE_RECOMMENDATIONS_SERVICE],
    },
];
