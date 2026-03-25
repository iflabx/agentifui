/**
 * External identity and immutable profile-attribute data access.
 *
 * This module defines the persistence boundary for:
 * - IdP identity mapping (issuer + subject -> user_id)
 * - Enterprise profile attributes synchronized from IdP/HR
 */
export type {
  IdentityPersistenceContext,
  UpsertProfileExternalAttributesInput,
  UpsertUserIdentityInput,
} from './user-identities/types';
export {
  getProfileExternalAttributes,
  upsertProfileExternalAttributes,
} from './user-identities/profile-external-attributes';
export {
  getUserIdentitiesByUserId,
  getUserIdentityByIssuerSubject,
  upsertUserIdentity,
} from './user-identities/user-identity';
