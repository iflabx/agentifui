/**
 * Security utilities for AgentifUI
 *
 * This module provides security functions to prevent:
 * - XSS attacks via URL injection
 * - Prototype pollution via JSON parsing
 * - Information disclosure via logging
 * - Data validation and sanitization
 */

function parseTrustedHost(candidate: string | undefined): string | null {
  const raw = (candidate || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).host;
  } catch {
    const withoutScheme = raw.replace(/^[a-z]+:\/\//i, '');
    return withoutScheme.split('/')[0]?.trim() || null;
  }
}

function collectTrustedAvatarHosts() {
  const configuredHosts = (process.env.TRUSTED_AVATAR_HOSTS || '')
    .split(',')
    .map(host => parseTrustedHost(host))
    .filter((host): host is string => Boolean(host));

  const derivedHosts = [
    parseTrustedHost(process.env.NEXT_PUBLIC_APP_URL),
    parseTrustedHost(process.env.S3_PUBLIC_BASE_URL),
    parseTrustedHost(process.env.S3_ENDPOINT),
    parseTrustedHost(process.env.NEXT_PUBLIC_SUPABASE_URL),
  ].filter((host): host is string => Boolean(host));

  return Array.from(new Set([...configuredHosts, ...derivedHosts]));
}

// Configuration for security settings
const SECURITY_CONFIG = {
  // Allowed protocols for avatar URLs
  ALLOWED_AVATAR_PROTOCOLS: ['http:', 'https:'],

  // Trusted avatar hosts (from env and runtime storage config)
  TRUSTED_AVATAR_HOSTS: collectTrustedAvatarHosts(),

  // Maximum URL length to prevent DoS
  MAX_URL_LENGTH: 2048,

  // Dangerous patterns to block
  DANGEROUS_PATTERNS: [
    /javascript:/i,
    /vbscript:/i,
    /data:.*script/i,
    /onload=/i,
    /onerror=/i,
    /onclick=/i,
    /onmouseover=/i,
    /<script/i,
    /<iframe/i,
    /&lt;script/i,
  ],

  // Profile field constraints
  MAX_FIELD_LENGTH: {
    full_name: 255,
    username: 100,
    employee_number: 50,
  },
} as const;

/**
 * Sanitize avatar URL to prevent XSS attacks
 *
 * @param url - The avatar URL to sanitize
 * @returns Sanitized URL or null if unsafe
 */
export function sanitizeAvatarUrl(
  url: string | null | undefined
): string | null {
  // Handle null/undefined/empty values
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  const trimmedUrl = url.trim();

  // Check URL length to prevent DoS
  if (trimmedUrl.length > SECURITY_CONFIG.MAX_URL_LENGTH) {
    console.warn(`[Security] Avatar URL too long: ${trimmedUrl.length} chars`);
    return null;
  }

  try {
    // Parse URL to validate structure
    const parsedUrl = new URL(trimmedUrl);

    // Only allow safe protocols
    if (
      !(SECURITY_CONFIG.ALLOWED_AVATAR_PROTOCOLS as readonly string[]).includes(
        parsedUrl.protocol
      )
    ) {
      console.warn(
        `[Security] Blocked unsafe avatar protocol: ${parsedUrl.protocol}`
      );
      return null;
    }

    // Check for dangerous patterns
    for (const pattern of SECURITY_CONFIG.DANGEROUS_PATTERNS) {
      if (pattern.test(trimmedUrl)) {
        console.warn(`[Security] Blocked dangerous pattern in avatar URL`);
        return null;
      }
    }

    // Additional validation for data URLs
    if (parsedUrl.protocol === 'data:') {
      const mediaType = trimmedUrl.split(',')[0].toLowerCase();
      if (mediaType.includes('script') || mediaType.includes('html')) {
        console.warn(`[Security] Blocked dangerous data URL type`);
        return null;
      }
    }

    // Log warning for non-trusted avatar hosts (but don't block them).
    if (
      SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS.length > 0 &&
      !SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS.includes(parsedUrl.host)
    ) {
      console.warn(
        `[Security] Avatar URL from untrusted domain: ${parsedUrl.hostname}`
      );
    }

    return trimmedUrl;
  } catch (error) {
    console.warn(
      `[Security] Invalid avatar URL format: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}

/**
 * Safe JSON parsing that prevents prototype pollution
 *
 * @param json - JSON string to parse
 * @returns Parsed object or null if unsafe/invalid
 */
export function safeJsonParse<T = unknown>(json: string): T | null {
  if (!json || typeof json !== 'string') {
    return null;
  }

  try {
    // First, check for obvious prototype pollution attempts
    const dangerousPatterns = [
      /__proto__/,
      /constructor.*prototype/,
      /prototype.*constructor/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(json)) {
        console.warn(
          `[Security] Blocked potential prototype pollution attempt`
        );
        return null;
      }
    }

    // Parse JSON
    const parsed = JSON.parse(json);

    // Additional runtime checks for parsed object
    if (parsed && typeof parsed === 'object') {
      // Check for prototype pollution properties
      const dangerousProps = ['__proto__', 'constructor', 'prototype'];
      for (const prop of dangerousProps) {
        if (Object.prototype.hasOwnProperty.call(parsed, prop)) {
          console.warn(
            `[Security] Blocked object with dangerous property: ${prop}`
          );
          return null;
        }
      }

      // Check for nested dangerous properties (one level deep)
      for (const key in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          const value = parsed[key];
          if (value && typeof value === 'object') {
            for (const prop of dangerousProps) {
              if (Object.prototype.hasOwnProperty.call(value, prop)) {
                console.warn(
                  `[Security] Blocked nested dangerous property: ${key}.${prop}`
                );
                return null;
              }
            }
          }
        }
      }
    }

    return parsed as T;
  } catch (error) {
    console.warn(
      `[Security] JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}

/**
 * Sanitize profile text fields to prevent XSS
 *
 * @param text - Text to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized text or null if invalid
 */
export function sanitizeProfileText(
  text: string | null | undefined,
  maxLength: number = 255
): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Trim whitespace
  const trimmed = text.trim();

  if (trimmed === '') {
    return null;
  }

  // Check length
  if (trimmed.length > maxLength) {
    console.warn(
      `[Security] Profile text too long: ${trimmed.length}/${maxLength} chars`
    );
    return trimmed.substring(0, maxLength);
  }

  // Check for dangerous patterns
  for (const pattern of SECURITY_CONFIG.DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.warn(`[Security] Blocked dangerous pattern in profile text`);
      return null;
    }
  }

  // Check for control characters and potentially dangerous Unicode
  const dangerousChars = /[\u0000-\u001f\u007f-\u009f]/g;
  if (dangerousChars.test(trimmed)) {
    console.warn(
      `[Security] Removed dangerous control characters from profile text`
    );
    return trimmed.replace(dangerousChars, '');
  }

  return trimmed;
}

/**
 * Validate profile cache data structure
 *
 * @param cacheData - Cache data to validate
 * @returns Validation result with sanitized data
 */
export interface ProfileCacheValidationResult<T> {
  isValid: boolean;
  data: T | null;
  errors: string[];
}

export function validateProfileCacheData<T extends Record<string, unknown>>(
  cacheData: unknown
): ProfileCacheValidationResult<T> {
  const errors: string[] = [];

  // Check basic structure
  if (!cacheData || typeof cacheData !== 'object') {
    errors.push('Invalid cache data structure');
    return { isValid: false, data: null, errors };
  }

  // Type assertion after basic validation
  const data = cacheData as Record<string, unknown>;

  // Check required fields
  const requiredFields = ['profile', 'timestamp', 'userId'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate timestamp
  if (typeof data.timestamp !== 'number' || data.timestamp < 0) {
    errors.push('Invalid timestamp');
  } else {
    // Check for future timestamps (allowing some clock skew)
    const maxSkew = 5 * 60 * 1000; // 5 minutes
    if (data.timestamp > Date.now() + maxSkew) {
      errors.push('Timestamp is too far in the future');
    }
  }

  // Validate userId
  const sanitizedUserId = sanitizeProfileText(data.userId as string, 100);
  if (!sanitizedUserId) {
    errors.push('Invalid userId');
  }

  // Validate profile object
  if (!data.profile || typeof data.profile !== 'object') {
    errors.push('Invalid profile object');
  } else {
    // Validate profile fields
    const profile = data.profile as Record<string, unknown>;

    // Sanitize avatar URL
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

    // Sanitize text fields
    const textFields: (keyof typeof SECURITY_CONFIG.MAX_FIELD_LENGTH)[] = [
      'full_name',
      'username',
      'employee_number',
    ];

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

/**
 * Safe console logging that doesn't expose sensitive information
 *
 * @param level - Log level ('log', 'warn', 'error')
 * @param category - Log category (e.g., 'Profile Cache')
 * @param message - Base message
 * @param sensitiveData - Optional sensitive data to mask
 */
export function secureLog(
  level: 'log' | 'warn' | 'error',
  category: string,
  message: string,
  sensitiveData?: string
): void {
  // In production, we might want to mask or omit sensitive data entirely
  const isProduction = process.env.NODE_ENV === 'production';

  let logMessage = `[${category}] ${message}`;

  if (sensitiveData) {
    if (isProduction) {
      // In production, just indicate that sensitive data was present
      logMessage += ' [sensitive data masked]';
    } else {
      // In development, show masked version for debugging
      const masked =
        sensitiveData.length > 8
          ? sensitiveData.substring(0, 4) +
            '***' +
            sensitiveData.substring(sensitiveData.length - 4)
          : '***';
      logMessage += ` (${masked})`;
    }
  }

  console[level](logMessage);
}

/**
 * Create a Content Security Policy configuration for avatar URLs
 *
 * @returns CSP configuration object
 */
export function createAvatarCSPConfig() {
  const trustedHosts = SECURITY_CONFIG.TRUSTED_AVATAR_HOSTS;
  const trustedSources = trustedHosts.flatMap(host => [
    `https://${host}`,
    `http://${host}`,
  ]);

  return {
    'img-src': [
      "'self'",
      'data:', // Allow data URLs for generated avatars
      ...trustedSources,
    ].filter(Boolean),

    // Prevent javascript: URLs in any context
    'script-src-elem': ["'self'"],
  };
}

// Export configuration for testing
export const __SECURITY_CONFIG_FOR_TESTING__ = SECURITY_CONFIG;
