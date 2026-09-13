import type { Db } from '@app/db';
import { WorkoutSessionsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

export const WORKOUT_SESSIONS_SERVICE = Symbol('WORKOUT_SESSIONS_SERVICE');
export const sessionServiceProviders: Provider[] = [
    {
        provide: WORKOUT_SESSIONS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): WorkoutSessionsService =>
            new WorkoutSessionsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
