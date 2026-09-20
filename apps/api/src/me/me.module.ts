import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import { ConnectedAppsController } from './connected-apps.controller.js';
import { MeController } from './me.controller.js';
import { meServiceProviders } from './me.providers.js';

/** Wires `GET/PATCH/DELETE /api/v1/me` and the `/api/v1/me/connected-apps` routes. */
@Module({
    imports: [OAuthModule],
    controllers: [MeController, ConnectedAppsController],
    providers: [...meServiceProviders],
})
export class MeModule {}
