import { sanitizeAvatarUrl } from './avatar';
import { SECURITY_CONFIG } from './config';
import { sanitizeProfileText } from './text';

export interface ProfileCacheValidationResult<T> {
  isValid: boolean;
  data: T | null;
  errors: string[];
}

export function validateProfileCacheData<T extends Record<string, unknown>>(
  cacheData: unknown
): ProfileCacheValidationResult<T> {
  const errors: string[] = [];

  if (!cacheData || typeof cacheData !== 'object') {
    errors.push('Invalid cache data structure');
    return { isValid: false, data: null, errors };
  }

  const data = cacheData as Record<string, unknown>;

  const requiredFields = ['profile', 'timestamp', 'userId'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof data.timestamp !== 'number' || data.timestamp < 0) {
    errors.push('Invalid timestamp');
  } else {
    const maxSkew = 5 * 60 * 1000;
    if (data.timestamp > Date.now() + maxSkew) {
      errors.push('Timestamp is too far in the future');
    }
  }

  const sanitizedUserId = sanitizeProfileText(data.userId as string, 100);
  if (!sanitizedUserId) {
    errors.push('Invalid userId');
  }

  if (!data.profile || typeof data.profile !== 'object') {
    errors.push('Invalid profile object');
  } else {
    const profile = data.profile as Record<string, unknown>;
    const textFields = Object.keys(
      SECURITY_CONFIG.MAX_FIELD_LENGTH
    ) as (keyof typeof SECURITY_CONFIG.MAX_FIELD_LENGTH)[];

    if (profile.avatar_url) {
      const sanitizedAvatarUrl = sanitizeAvatarUrl(
        profile.avatar_url as string
      );
      if (sanitizedAvatarUrl !== profile.avatar_url) {
        if (sanitizedAvatarUrl === null) {
          errors.push('Invalid avatar URL - removed for security');
          profile.avatar_url = null;
        } else {
          profile.avatar_url = sanitizedAvatarUrl;
        }
      }
    }

    for (const field of textFields) {
      if (profile[field]) {
        const maxLength = SECURITY_CONFIG.MAX_FIELD_LENGTH[field];
        const sanitized = sanitizeProfileText(
          profile[field] as string,
          maxLength
        );
        if (sanitized !== profile[field]) {
          if (sanitized === null) {
            errors.push(`Invalid ${field} - removed for security`);
            profile[field] = null;
          } else {
            profile[field] = sanitized;
          }
        }
      }
    }
  }

  const isValid = errors.length === 0;
  return {
    isValid,
    data: isValid ? (data as T) : null,
    errors,
  };
}
