import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { EquipmentPresetsModule } from './equipment-presets/equipment-presets.module.js';
import { ExercisesModule } from './exercises/exercises.module.js';
import { HealthController } from './health/health.controller.js';
import { InfrastructureModule } from './infrastructure.module.js';
import { MeModule } from './me/me.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { RoutinesModule } from './routines/routines.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

/**
 * The application's root module. Pure composition - controllers and feature module imports only.
 * Infrastructure (the logger, the pooled `Db` handle, `AuthService`, the guards) lives in
 * `InfrastructureModule`, imported here so every feature module below can reach those tokens
 * without re-declaring them.
 *
 * The request-context middleware is NOT wired here via `NestModule.configure()`: under
 * `@nestjs/platform-fastify`, middleware registered that way runs through `@fastify/middie`, which
 * hands the callback the raw Node `req`/`res` (no `.header()`, no Fastify decorators) - not the
 * `FastifyRequest`/`FastifyReply` pair `RequestContextMiddleware` is typed against.
 * `registerRequestContextHook` (bootstrap.ts) attaches it as a real Fastify `onRequest` hook
 * instead, on the instances both `createApp` and `test/harness.ts` build.
 */
@Module({
    imports: [
        InfrastructureModule,
        AuthModule,
        MeModule,
        WorkspacesModule,
        EquipmentPresetsModule,
        OnboardingModule,
        ExercisesModule,
        RoutinesModule,
        SessionsModule,
    ],
    controllers: [HealthController],
})
export class AppModule {}
