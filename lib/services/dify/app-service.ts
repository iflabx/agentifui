import type { ServiceInstanceConfig } from '@lib/types/database';

import type {
  DifyApiError,
  DifyAppInfoResponse,
  DifyAppMetaResponse,
  DifyAppParametersResponse,
  DifyWebAppSettingsResponse,
} from './types';

/**
 * Get all available Dify apps (for admin use).
 * Returns all apps, including private ones, for the management interface.
 */
export async function getAllDifyApps(): Promise<
  Array<{
    id: string;
    name: string;
    instance_id: string;
    display_name?: string;
    description?: string;
    config?: ServiceInstanceConfig;
    visibility?: string;
  }>
> {
  try {
    if (typeof window !== 'undefined') {
      const response = await fetch('/api/internal/apps?scope=all', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch app list');
      }

      const data = (await response.json()) as {
        success: boolean;
        apps: Array<{
          id: string;
          name: string;
          instance_id: string;
          display_name?: string;
          description?: string;
          config?: ServiceInstanceConfig;
          visibility?: string;
        }>;
      };

      return data.apps || [];
    }

    return queryAppsFromDatabase(false);
  } catch (error) {
    console.error('Failed to get app list:', error);
    throw error;
  }
}

/**
 * Get public Dify apps (for unauthenticated users).
 * Only returns public apps, for the app marketplace.
 */
export async function getPublicDifyApps(): Promise<
  Array<{
    id: string;
    name: string;
    instance_id: string;
    display_name?: string;
    description?: string;
    config?: ServiceInstanceConfig;
    visibility?: string;
  }>
> {
  try {
    if (typeof window !== 'undefined') {
      const response = await fetch('/api/internal/apps?scope=public', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch public apps');
      }

      const data = (await response.json()) as {
        success: boolean;
        apps: Array<{
          id: string;
          name: string;
          instance_id: string;
          display_name?: string;
          description?: string;
          config?: ServiceInstanceConfig;
          visibility?: string;
        }>;
      };

      return data.apps || [];
    }

    return queryAppsFromDatabase(true);
  } catch (error) {
    console.error('Failed to get public app list:', error);
    throw error;
  }
}

async function queryAppsFromDatabase(publicOnly: boolean) {
  const { getPgPool } = await import('@lib/server/pg/pool');
  const pool = getPgPool();
  const params: unknown[] = [];
  const visibilityFilter = publicOnly ? `AND si.visibility = 'public'` : '';
  const { rows } = await pool.query<{
    id: string;
    instance_id: string;
    display_name: string | null;
    description: string | null;
    config: ServiceInstanceConfig | null;
    visibility: string | null;
  }>(
    `
      SELECT
        si.id::text AS id,
        si.instance_id,
        si.display_name,
        si.description,
        si.config,
        si.visibility
      FROM service_instances si
      INNER JOIN providers p ON p.id = si.provider_id
      WHERE p.is_active = TRUE
      ${visibilityFilter}
      ORDER BY si.display_name ASC NULLS LAST, si.instance_id ASC
    `,
    params
  );

  return rows.map(instance => ({
    id: instance.id,
    name: instance.display_name || instance.instance_id,
    instance_id: instance.instance_id,
    display_name: instance.display_name || undefined,
    description: instance.description || undefined,
    config: (instance.config || {}) as ServiceInstanceConfig,
    visibility: instance.visibility || 'public',
  }));
}

/**
 * Get app parameters.
 * Used at page entry to get feature switches, input parameter names, types, and default values, etc.
 *
 * @param appId - App ID
 * @returns Promise<DifyAppParametersResponse> - App parameter configuration
 */
export async function getDifyAppParameters(
  appId: string
): Promise<DifyAppParametersResponse> {
  const slug = 'parameters'; // Dify API path
  const apiUrl = `/api/dify/${appId}/${slug}`; // Points to backend proxy

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get app parameters',
        };
      }

      console.error(
        '[Dify App Service] Failed to get app parameters:',
        errorData
      );
      throw new Error(`Failed to get app parameters: ${errorData.message}`);
    }

    const result: DifyAppParametersResponse = await response.json();

    console.log('[Dify App Service] Successfully got app parameters:', {
      appId,
      hasOpeningStatement: !!result.opening_statement,
      suggestedQuestionsCount: result.suggested_questions?.length || 0,
      userInputFormCount: result.user_input_form?.length || 0,
      textToSpeechEnabled: result.text_to_speech?.enabled || false,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting app parameters:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting app parameters');
  }
}

/**
 * Test get app parameters API (for development/debug only)
 *
 * @param appId - App ID
 */
export async function testDifyAppParameters(appId: string): Promise<void> {
  try {
    console.log(`[Test] Start testing app parameters API, appId: ${appId}`);

    const parameters = await getDifyAppParameters(appId);

    console.log(`[Test] Successfully got app parameters:`, {
      appId,
      opening_statement: parameters.opening_statement,
      suggested_questions_count: parameters.suggested_questions?.length || 0,
      user_input_form_count: parameters.user_input_form?.length || 0,
      file_upload_enabled: parameters.file_upload?.image?.enabled || false,
      speech_to_text_enabled: parameters.speech_to_text?.enabled || false,
      text_to_speech_enabled: parameters.text_to_speech?.enabled || false,
      retriever_resource_enabled:
        parameters.retriever_resource?.enabled || false,
      annotation_reply_enabled: parameters.annotation_reply?.enabled || false,
    });
  } catch (error) {
    console.error(`[Test] Failed to test app parameters API:`, error);
    throw error;
  }
}

/**
 * Get app basic info
 *
 * @param appId - App ID
 * @returns Promise<DifyAppInfoResponse> - App basic info
 */
export async function getDifyAppInfo(
  appId: string
): Promise<DifyAppInfoResponse> {
  const slug = 'info'; // Dify API path
  const apiUrl = `/api/dify/${appId}/${slug}`; // Points to backend proxy

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get app info',
        };
      }

      console.error('[Dify App Service] Failed to get app info:', errorData);
      throw new Error(`Failed to get app info: ${errorData.message}`);
    }

    const result: DifyAppInfoResponse = await response.json();

    console.log('[Dify App Service] Successfully got app info:', {
      appId,
      name: result.name,
      description: result.description,
      tagsCount: result.tags?.length || 0,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting app info:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting app info');
  }
}

/**
 * Get app WebApp settings
 *
 * @param appId - App ID
 * @returns Promise<DifyWebAppSettingsResponse> - WebApp settings info
 */
export async function getDifyWebAppSettings(
  appId: string
): Promise<DifyWebAppSettingsResponse> {
  const slug = 'site'; // Dify API path
  const apiUrl = `/api/dify/${appId}/${slug}`; // Points to backend proxy

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get WebApp settings',
        };
      }

      console.error(
        '[Dify App Service] Failed to get WebApp settings:',
        errorData
      );
      throw new Error(`Failed to get WebApp settings: ${errorData.message}`);
    }

    const result: DifyWebAppSettingsResponse = await response.json();

    console.log('[Dify App Service] Successfully got WebApp settings:', {
      appId,
      title: result.title,
      iconType: result.icon_type,
      hasDescription: !!result.description,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting WebApp settings:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting WebApp settings');
  }
}

/**
 * Get app Meta info
 *
 * @param appId - App ID
 * @returns Promise<DifyAppMetaResponse> - App Meta info
 */
export async function getDifyAppMeta(
  appId: string
): Promise<DifyAppMetaResponse> {
  const slug = 'meta'; // Dify API path
  const apiUrl = `/api/dify/${appId}/${slug}`; // Points to backend proxy

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // No Authorization header needed, handled by proxy
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get app Meta info',
        };
      }

      console.error(
        '[Dify App Service] Failed to get app Meta info:',
        errorData
      );
      throw new Error(`Failed to get app Meta info: ${errorData.message}`);
    }

    const result: DifyAppMetaResponse = await response.json();

    console.log('[Dify App Service] Successfully got app Meta info:', {
      appId,
      toolIconsCount: Object.keys(result.tool_icons).length,
    });

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting app Meta info:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while getting app Meta info');
  }
}

/**
 * Get Dify app parameters using the specified API config (for form sync)
 *
 * @param appId - App ID
 * @param apiConfig - API config (URL and key)
 * @returns Promise<DifyAppParametersResponse> - App parameters
 */
export async function getDifyAppParametersWithConfig(
  appId: string,
  apiConfig: { apiUrl: string; apiKey: string }
): Promise<DifyAppParametersResponse> {
  const { apiUrl, apiKey } = apiConfig;

  if (!apiUrl || !apiKey) {
    throw new Error('API URL and API Key are required');
  }

  // Architecture fix: Call via temporary proxy to avoid direct external API call
  // Create a temporary service instance config, call via proxy server
  try {
    console.log(
      `[Dify App Service] Sync parameters via proxy with form config: ${appId}`
    );

    // Call via proxy server, using special temporary config
    const slug = 'parameters';
    const proxyUrl = `/api/dify/${appId}/${slug}`;

    const response = await fetch(proxyUrl, {
      method: 'POST', // Use POST to send temporary config
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        _temp_config: {
          apiUrl,
          apiKey,
        },
      }),
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get app parameters',
        };
      }

      console.error(
        '[Dify App Service] Failed to get app parameters with form config:',
        errorData
      );
      throw new Error(`Failed to get app parameters: ${errorData.message}`);
    }

    const result: DifyAppParametersResponse = await response.json();

    console.log(
      '[Dify App Service] Successfully got app parameters with form config:',
      {
        appId,
        hasOpeningStatement: !!result.opening_statement,
        suggestedQuestionsCount: result.suggested_questions?.length || 0,
        userInputFormCount: result.user_input_form?.length || 0,
        textToSpeechEnabled: result.text_to_speech?.enabled || false,
      }
    );

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting app parameters with form config:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      'Unknown error occurred while getting app parameters with form config'
    );
  }
}

/**
 * Get Dify app basic info using the specified API config (for form sync)
 *
 * @param appId - App ID
 * @param apiConfig - API config (URL and key)
 * @returns Promise<DifyAppInfoResponse> - App basic info
 */
export async function getDifyAppInfoWithConfig(
  appId: string,
  apiConfig: { apiUrl: string; apiKey: string }
): Promise<DifyAppInfoResponse> {
  const { apiUrl, apiKey } = apiConfig;

  if (!apiUrl || !apiKey) {
    throw new Error('API URL and API Key are required');
  }

  // Architecture fix: Call via temporary proxy to avoid direct external API call
  // Create a temporary service instance config, call via proxy server
  try {
    console.log(
      `[Dify App Service] Sync basic info via proxy with form config: ${appId}`
    );

    // Call via proxy server, using special temporary config
    const slug = 'info';
    const proxyUrl = `/api/dify/${appId}/${slug}`;

    const response = await fetch(proxyUrl, {
      method: 'POST', // Use POST to send temporary config
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        _temp_config: {
          apiUrl,
          apiKey,
        },
      }),
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: DifyApiError;
      try {
        errorData = await response.json();
      } catch {
        // If cannot parse JSON, use default error format
        errorData = {
          status: response.status,
          code: response.status.toString(),
          message: response.statusText || 'Failed to get app basic info',
        };
      }

      console.error(
        '[Dify App Service] Failed to get app basic info with form config:',
        errorData
      );
      throw new Error(`Failed to get app basic info: ${errorData.message}`);
    }

    const result: DifyAppInfoResponse = await response.json();

    console.log(
      '[Dify App Service] Successfully got app basic info with form config:',
      {
        appId,
        name: result.name,
        description: result.description,
        tagsCount: result.tags?.length || 0,
      }
    );

    return result;
  } catch (error) {
    console.error(
      '[Dify App Service] Error occurred while getting app basic info with form config:',
      error
    );

    // Rethrow error to preserve error info
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      'Unknown error occurred while getting app basic info with form config'
    );
  }
}
