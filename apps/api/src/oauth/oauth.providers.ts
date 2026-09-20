import { type Db } from '@app/db';
import {
    ClientIdMetadataService,
    ConnectedAppsService,
    OAuthAuthorizationService,
    OAuthClientsService,
    OAuthTokensService,
    parseAllowedClientDomains,
    type WorkspaceMembershipService,
} from '@app/services';
import { RESOURCE_URL_GENERATOR, type ResourceUrlGenerator } from '@app/nest-common';
import type { Provider } from '@nestjs/common';
import { loadEnv } from '../config/load-env.js';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `OAuthClientsService` factory provider below. */
export const OAUTH_CLIENTS_SERVICE = Symbol('OAUTH_CLIENTS_SERVICE');

/** DI token for the `OAuthAuthorizationService` factory provider below. */
export const OAUTH_AUTHORIZATION_SERVICE = Symbol('OAUTH_AUTHORIZATION_SERVICE');

/** DI token for the `OAuthTokensService` factory provider below. */
export const OAUTH_TOKENS_SERVICE = Symbol('OAUTH_TOKENS_SERVICE');

/** DI token for the `ConnectedAppsService` factory provider below. */
export const CONNECTED_APPS_SERVICE = Symbol('CONNECTED_APPS_SERVICE');

/**
 * Split out from `oauth.module.ts` for the reason `me.providers.ts` documents: the controllers
 * import these tokens and the module imports the controllers, so declaring them in the module file
 * would leave them `undefined` at `@Inject()` decoration time under ESM's circular-import order.
 */
export const oauthServiceProviders: Provider[] = [
    {
        provide: OAUTH_CLIENTS_SERVICE,
        useFactory: (db: Db): OAuthClientsService =>
            new OAuthClientsService({
                db,
                metadata: new ClientIdMetadataService(),
                allowedDomains: parseAllowedClientDomains(String(loadEnv()['MCP_OAUTH_ALLOWED_CLIENT_DOMAINS'])),
            }),
        inject: [DB],
    },
    {
        provide: OAUTH_AUTHORIZATION_SERVICE,
        useFactory: (
            db: Db,
            clients: OAuthClientsService,
            membership: WorkspaceMembershipService,
            urls: ResourceUrlGenerator,
        ): OAuthAuthorizationService => new OAuthAuthorizationService({ db, clients, membership, issuer: urls.issuer }),
        inject: [DB, OAUTH_CLIENTS_SERVICE, WORKSPACE_MEMBERSHIP_SERVICE, RESOURCE_URL_GENERATOR],
    },
    {
        provide: OAUTH_TOKENS_SERVICE,
        useFactory: (db: Db): OAuthTokensService => new OAuthTokensService({ db }),
        inject: [DB],
    },
    {
        provide: CONNECTED_APPS_SERVICE,
        useFactory: (db: Db): ConnectedAppsService => new ConnectedAppsService({ db }),
        inject: [DB],
    },
];
