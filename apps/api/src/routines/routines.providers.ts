import { type Db } from '@app/db';
import { RoutinesService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `RoutinesService` factory provider below. */
export const ROUTINES_SERVICE = Symbol('ROUTINES_SERVICE');

/** Split out from `routines.module.ts` to avoid a circular import between that module and its controllers. */
export const routineServiceProviders: Provider[] = [
    {
        provide: ROUTINES_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): RoutinesService =>
            new RoutinesService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
