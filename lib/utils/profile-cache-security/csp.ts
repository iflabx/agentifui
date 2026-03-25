import { SECURITY_CONFIG } from './config';

export function createAvatarCSPConfig() {
  const trustedSources = SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS.flatMap(host => [
    `https://${host}`,
    `http://${host}`,
  ]);

  return {
    'img-src': ["'self'", 'data:', ...trustedSources].filter(Boolean),
    'script-src-elem': ["'self'"],
  };
}
