import { z } from 'zod';

/** `POST /api/v1/auth/login`. */
export const loginRequestSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

/**
 * `POST /api/v1/auth/signup`. The 8-character minimum matches the one
 * `UserProvisioningService.signUp` enforces; change both together.
 */
export const signupRequestSchema = z.object({
    email: z.email(),
    password: z.string().min(8),
    displayName: z.string().max(100).nullable().optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
