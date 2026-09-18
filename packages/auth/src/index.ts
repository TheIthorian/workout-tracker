export {
    AUTH_SCHEMA,
    buildAuthOptions,
    SESSION_EXPIRES_IN_SECONDS,
    SESSION_UPDATE_AGE_SECONDS,
    type AuthConfig,
} from './auth-options.js';
export {
    AuthService,
    type AuthHandlerResponse,
    type AuthServiceDeps,
    type LoginParams,
    type LogoutParams,
} from './auth.service.js';
export { isCredentialRejection } from './api-error.js';
export { LockoutService, SIGN_IN_EMAIL_PATH } from './lockout.service.js';
export {
    extractMcpTokenFromPath,
    generateMcpToken,
    hashMcpToken,
    McpTokenService,
    type McpTokenValidationResult,
} from './mcp-token.js';
export {
    type SignUpParams,
    type UserProvisioningConfig,
    UserProvisioningService,
} from './user-provisioning.service.js';
