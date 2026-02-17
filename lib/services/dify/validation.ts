import type { ServiceInstanceConfig } from '@lib/types/database';
import { isValidDifyAppType } from '@lib/types/dify-app-types';

/**
 * Dify app config validation service
 */

export interface DifyConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface DifyFormData {
  instance_id?: string;
  display_name?: string;
  config?: {
    app_metadata?: {
      dify_apptype?: string;
      app_type?: string;
    };
  };
}

/**
 * Validate Dify app config
 * @param config Service instance config
 * @returns Validation result
 */
export function validateDifyAppConfig(
  config: ServiceInstanceConfig
): DifyConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Validate if app_metadata exists ---
  if (!config.app_metadata) {
    errors.push('App metadata config cannot be empty');
    return { isValid: false, errors, warnings };
  }

  // --- Validate dify_apptype existence and validity ---
  if (!config.app_metadata.dify_apptype) {
    errors.push('Dify app type cannot be empty');
  } else if (!isValidDifyAppType(config.app_metadata.dify_apptype)) {
    errors.push(`Invalid Dify app type: ${config.app_metadata.dify_apptype}`);
  }

  // --- Validate app_type existence ---
  if (!config.app_metadata.app_type) {
    warnings.push('It is recommended to set app_type');
  } else if (!['model', 'marketplace'].includes(config.app_metadata.app_type)) {
    errors.push(`Invalid app type: ${config.app_metadata.app_type}`);
  }

  // --- Validate brief_description for marketplace type ---
  if (
    !config.app_metadata.brief_description &&
    config.app_metadata.app_type === 'marketplace'
  ) {
    warnings.push(
      'It is recommended to add a brief description for marketplace type apps'
    );
  }

  // --- Validate tags config ---
  if (config.app_metadata.tags && !Array.isArray(config.app_metadata.tags)) {
    errors.push('App tags must be an array');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate Dify config from form data
 * @param formData Form data
 * @returns Array of error messages
 */
export function validateDifyFormData(formData: DifyFormData): string[] {
  const errors: string[] = [];

  // --- Validate basic fields ---
  if (!formData.instance_id?.trim()) {
    errors.push('App instance ID cannot be empty');
  } else {
    const instanceId = formData.instance_id.trim();

    if (instanceId.includes(' ')) {
      errors.push(
        'App instance ID cannot contain spaces (affects URL routing)'
      );
    }

    const urlUnsafeChars = /[^a-zA-Z0-9\-_\.]/;
    if (urlUnsafeChars.test(instanceId)) {
      errors.push(
        'App instance ID can only contain letters, numbers, hyphens (-), underscores (_), and dots (.)'
      );
    }

    if (instanceId.length > 50) {
      errors.push('App instance ID cannot exceed 50 characters');
    }

    if (!/^[a-zA-Z0-9]/.test(instanceId)) {
      errors.push('App instance ID must start with a letter or number');
    }
  }

  if (!formData.display_name?.trim()) {
    errors.push('Display name cannot be empty');
  }

  if (!formData.config?.app_metadata?.dify_apptype) {
    errors.push('Please select a Dify app type');
  } else if (!isValidDifyAppType(formData.config.app_metadata.dify_apptype)) {
    errors.push('Please select a valid Dify app type');
  }

  if (!formData.config?.app_metadata?.app_type) {
    errors.push('Please select an app type');
  }

  // --- Validate API config (commented out) ---
  //   if (!formData.config?.api_url?.trim()) {
  //     errors.push('API URL cannot be empty');
  //   }

  //   if (!formData.apiKey?.trim()) {
  //     errors.push('API key cannot be empty');
  //   }

  return errors;
}

/**
 * Generate config suggestions
 * @param config Service instance config
 * @returns Array of suggestion messages
 */
export function generateConfigSuggestions(
  config: ServiceInstanceConfig
): string[] {
  const suggestions: string[] = [];

  if (!config.app_metadata) {
    return suggestions;
  }

  const { dify_apptype, app_type } = config.app_metadata;

  // --- Suggestion based on Dify app type ---
  if (dify_apptype === 'workflow' && app_type === 'model') {
    suggestions.push(
      'For workflow apps, it is recommended to set app_type as marketplace instead of model'
    );
  }

  return suggestions;
}
