import { type Db } from '@app/db';
import { MuscleVolumeService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for per-muscle training volume. */
export const MUSCLE_VOLUME_SERVICE = Symbol('MUSCLE_VOLUME_SERVICE');

/** Split out from the module file to avoid a circular import between it and its controller. */
export const analyticsServiceProviders: Provider[] = [
    {
        provide: MUSCLE_VOLUME_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): MuscleVolumeService =>
            new MuscleVolumeService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
