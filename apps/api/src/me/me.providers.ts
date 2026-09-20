import { type Db } from '@app/db';
import { UsersService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB } from '../providers.js';

/** DI token for the `UsersService` factory provider below. */
export const USERS_SERVICE = Symbol('USERS_SERVICE');

/**
 * Split out from `me.module.ts` (rather than declared there) to avoid a circular import between
 * that module and its controllers - `MeController` imports this token, and `me.module.ts` imports the controllers, so declaring the tokens in the module file
 * itself would leave them `undefined` at the controllers' `@Inject()` decoration time under ESM's
 * circular-import evaluation order.
 */
export const meServiceProviders: Provider[] = [
    {
        provide: USERS_SERVICE,
        useFactory: (db: Db): UsersService => new UsersService({ db }),
        inject: [DB],
    },
];
