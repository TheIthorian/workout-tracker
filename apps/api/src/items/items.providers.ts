import { type Db } from '@app/db';
import { ItemsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `ItemsService` factory provider below. */
export const ITEMS_SERVICE = Symbol('ITEMS_SERVICE');

/**
 * Split out from `items.module.ts` to avoid a circular import between that module and its
 * controller - see `workspaces.providers.ts` for the full reasoning.
 */
export const itemServiceProviders: Provider[] = [
    {
        provide: ITEMS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ItemsService =>
            new ItemsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
