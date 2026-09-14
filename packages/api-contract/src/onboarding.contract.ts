import { OnboardingStage } from '@app/domain';
import { z } from 'zod';

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/onboarding`. */
export const patchOnboardingRequestSchema = z.object({
    stage: z.enum(OnboardingStage),
});

export const onboardingResponseSchema = z.object({
    stage: z.enum(OnboardingStage),
});

export type PatchOnboardingRequest = z.infer<typeof patchOnboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
