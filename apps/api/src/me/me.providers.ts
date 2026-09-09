import { type Db } from '@app/db';
import { McpAccessTokensService, UsersService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `UsersService` factory provider below. */
export const USERS_SERVICE = Symbol('USERS_SERVICE');

/** DI token for the `McpAccessTokensService` factory provider below. */
export const MCP_ACCESS_TOKENS_SERVICE = Symbol('MCP_ACCESS_TOKENS_SERVICE');

/**
 * Split out from `me.module.ts` (rather than declared there) to avoid a circular import between
 * that module and its controllers - `MeController`/`McpAccessTokensController` import these
 * tokens, and `me.module.ts` imports the controllers, so declaring the tokens in the module file
 * itself would leave them `undefined` at the controllers' `@Inject()` decoration time under ESM's
 * circular-import evaluation order.
 */
export const meServiceProviders: Provider[] = [
    {
        provide: USERS_SERVICE,
        useFactory: (db: Db): UsersService => new UsersService({ db }),
        inject: [DB],
    },
    {
        provide: MCP_ACCESS_TOKENS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): McpAccessTokensService =>
            new McpAccessTokensService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
