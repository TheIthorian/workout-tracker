import { Module } from '@nestjs/common';
import { workspaceServiceProviders } from '../workspaces/workspaces.providers.js';
import { OnboardingController } from './onboarding.controller.js';

/** Wires `/api/v1/workspaces/:workspaceId/onboarding`. */
@Module({
    controllers: [OnboardingController],
    providers: [...workspaceServiceProviders],
})
export class OnboardingModule {}
