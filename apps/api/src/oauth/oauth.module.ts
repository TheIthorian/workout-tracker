import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { oauthServiceProviders } from './oauth.providers.js';
import { WellKnownController } from './well-known.controller.js';

/** Wires the OAuth 2.1 authorization server and the discovery document that advertises it. */
@Module({
    controllers: [WellKnownController, OAuthController],
    providers: [...oauthServiceProviders],
    exports: [...oauthServiceProviders],
})
export class OAuthModule {}
