import { Global, Module } from '@nestjs/common';
import { RESOURCE_URL_GENERATOR } from '@app/nest-common';
import { APP_LOGGER, infrastructureProviders } from './providers.js';

/**
 * Holds the providers every feature depends on, exported so a feature module reaches them by token
 * without re-declaring them. `@Global()` so every feature module reaches `RESOURCE_URL_GENERATOR`
 * without importing this module directly.
 */
@Global()
@Module({
    providers: infrastructureProviders,
    exports: [APP_LOGGER, RESOURCE_URL_GENERATOR],
})
export class InfrastructureModule {}
