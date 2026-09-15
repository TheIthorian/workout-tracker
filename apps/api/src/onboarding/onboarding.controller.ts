import {
    guidSchema,
    patchOnboardingRequestSchema,
    type OnboardingResponse,
    type PatchOnboardingRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { WorkspacesService } from '@app/services';
import { Controller, Inject, Patch, UseGuards } from '@nestjs/common';
import { WORKSPACES_SERVICE } from '../workspaces/workspaces.providers.js';

/** First-run setup progress. The stage is read from `GET /me`; this only moves it. */
@Controller('v1/workspaces/:workspaceId/onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
    constructor(@Inject(WORKSPACES_SERVICE) private readonly workspaces: WorkspacesService) {}

    /** Records the workspace's onboarding stage. Idempotent. */
    @Patch()
    async patchOnboarding(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(patchOnboardingRequestSchema) body: PatchOnboardingRequest,
    ): Promise<OnboardingResponse> {
        return this.workspaces.setOnboardingStage({ userId: currentUser.userId, workspaceId, stage: body.stage });
    }
}
