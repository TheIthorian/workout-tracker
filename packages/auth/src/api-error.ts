import { isAPIError } from 'better-auth/api';

/**
 * Whether Better Auth rejected the credential itself, as opposed to failing to answer.
 *
 * Better Auth reports a credential it examined and refused as an `APIError`; a store it could not
 * reach surfaces as whatever the database adapter threw. Only the first means "not signed in" -
 * the second leaves the question unanswered, and answering it with a 401 signs a visitor out over
 * a connection blip.
 *
 * @param error anything thrown out of an `auth.api.*` call.
 */
export function isCredentialRejection(error: unknown): boolean {
    return isAPIError(error);
}
