import { ManagedCasProviderConfig } from './types';

export function buildManagedCasLoginUrl(
  config: ManagedCasProviderConfig,
  serviceUrl: string
): string {
  const loginUrl = new URL(config.loginEndpoint, `${config.baseUrl}/`);
  loginUrl.searchParams.set('service', serviceUrl);
  return loginUrl.toString();
}

export function buildManagedCasValidateUrl(
  config: ManagedCasProviderConfig,
  serviceUrl: string,
  ticket: string
): string {
  const validatePath = config.validateEndpointV3 || config.validateEndpoint;
  const validateUrl = new URL(validatePath, `${config.baseUrl}/`);
  validateUrl.searchParams.set('service', serviceUrl);
  validateUrl.searchParams.set('ticket', ticket);
  return validateUrl.toString();
}
