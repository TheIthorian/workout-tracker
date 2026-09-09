import { type Db } from '@app/db';
import { WorkspacesService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `WorkspacesService` factory provider below. */
export const WORKSPACES_SERVICE = Symbol('WORKSPACES_SERVICE');

/**
 * Split out from `workspaces.module.ts` (rather than declared there) to avoid a circular import
 * between that module and its controller - the controller imports this token, and the module
 * imports the controller, so declaring it in the module file would leave it `undefined` at the
 * controller's `@Inject()` decoration time under ESM's circular-import evaluation order.
 */
export const workspaceServiceProviders: Provider[] = [
    {
        provide: WORKSPACES_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): WorkspacesService =>
            new WorkspacesService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
