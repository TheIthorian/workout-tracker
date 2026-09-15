import { type Db } from '@app/db';
import { EquipmentPresetsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `EquipmentPresetsService` factory provider below. */
export const EQUIPMENT_PRESETS_SERVICE = Symbol('EQUIPMENT_PRESETS_SERVICE');

/** Split out from the module file to avoid a circular import between it and its controller. */
export const equipmentPresetServiceProviders: Provider[] = [
    {
        provide: EQUIPMENT_PRESETS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): EquipmentPresetsService =>
            new EquipmentPresetsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
