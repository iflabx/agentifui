import { SsoProvider, SsoProviderSettings } from '@lib/types/database';

export type { SsoProvider, SsoProviderSettings };

export type PublicSsoAuthFlow = 'better-auth' | 'managed-cas';

export interface PublicLoginSsoProvider {
  providerId: string;
  domain: string;
  displayName: string;
  icon: string;
  mode: 'native' | 'cas-bridge' | 'managed-cas';
  authFlow: PublicSsoAuthFlow;
  description?: string | null;
}

export interface ManagedCasProviderConfig {
  id: string;
  providerId: string;
  accountProviderId: string;
  displayName: string;
  icon: string;
  description: string | null;
  domain: string;
  issuer: string;
  baseUrl: string;
  loginEndpoint: string;
  logoutEndpoint: string;
  validateEndpoint: string;
  validateEndpointV3: string | null;
  emailDomain: string | null;
  allowedRedirectHosts: string[];
  attributeMapping: {
    employeeId: string;
    username: string;
    fullName: string;
    email: string;
  };
}

export interface ParsedCasServiceResponse {
  success: boolean;
  user: string | null;
  attributes: Record<string, string | string[]>;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface ResolvedManagedCasProfile {
  subject: string;
  username: string;
  fullName: string;
  email: string | null;
  employeeNumber: string | null;
  rawAttributes: Record<string, string | string[]>;
}
