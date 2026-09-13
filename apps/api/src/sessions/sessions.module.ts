import { Module } from '@nestjs/common';
import { SessionEditingController } from './session-editing.controller.js';
import { SessionsController } from './sessions.controller.js';
import { sessionServiceProviders } from './sessions.providers.js';

/** Wires the workspace session routes. */
@Module({ controllers: [SessionsController, SessionEditingController], providers: [...sessionServiceProviders] })
export class SessionsModule {}
