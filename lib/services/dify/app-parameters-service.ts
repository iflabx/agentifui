import { getAppParametersFromDb } from '@lib/db/service-instances';
import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { Result } from '@lib/types/result';
import { failure, success } from '@lib/types/result';

/**
 * Unified App Parameters Service
 *
 * Core strategy:
 * 1. Prefer local config from database (instant loading)
 * 2. No fallback to Dify API (compatibility not implemented here)
 */

interface AppParametersCache {
  [appId: string]: {
    data: DifyAppParametersResponse | null;
    timestamp: number;
    source: 'database';
  };
}

// 30 minutes cache duration for app parameters
const CACHE_DURATION = 30 * 60 * 1000;
const parametersCache: AppParametersCache = {};

/**
 * Convert database config to Dify parameters format
 */
function convertDatabaseConfigToDifyParameters(
  config: unknown
): DifyAppParametersResponse | null {
  if (!config) return null;

  try {
    const resolvedConfig =
      typeof config === 'object' && config !== null
        ? (config as Record<string, unknown>)
        : {};

    // Ensure the returned object matches DifyAppParametersResponse format
    return {
      opening_statement: (resolvedConfig.opening_statement as string) || '',
      suggested_questions:
        (resolvedConfig.suggested_questions as string[]) || [],
      suggested_questions_after_answer:
        (resolvedConfig.suggested_questions_after_answer as {
          enabled: boolean;
        }) || {
          enabled: false,
        },
      speech_to_text: (resolvedConfig.speech_to_text as {
        enabled: boolean;
      }) || {
        enabled: false,
      },
      text_to_speech: (resolvedConfig.text_to_speech as {
        enabled: boolean;
      }) || {
        enabled: false,
      },
      retriever_resource: (resolvedConfig.retriever_resource as {
        enabled: boolean;
      }) || {
        enabled: false,
      },
      annotation_reply: (resolvedConfig.annotation_reply as {
        enabled: boolean;
      }) || {
        enabled: false,
      },
      user_input_form:
        (resolvedConfig.user_input_form as DifyAppParametersResponse['user_input_form']) ||
        [],
      file_upload:
        (resolvedConfig.file_upload as DifyAppParametersResponse['file_upload']) || {
          image: {
            enabled: false,
            number_limits: 3,
            transfer_methods: ['local_file', 'remote_url'],
          },
        },
      system_parameters:
        (resolvedConfig.system_parameters as DifyAppParametersResponse['system_parameters']) || {
          file_size_limit: 15,
          image_file_size_limit: 10,
          audio_file_size_limit: 50,
          video_file_size_limit: 100,
        },
    };
  } catch (error) {
    console.error(
      '[AppParametersService] Failed to convert database config:',
      error
    );
    return null;
  }
}

/**
 * Get cached parameters for an app
 */
function getCachedParameters(appId: string): DifyAppParametersResponse | null {
  const cached = parametersCache[appId];
  if (!cached) return null;

  const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;
  if (isExpired) {
    delete parametersCache[appId];
    return null;
  }

  return cached.data;
}

/**
 * Set parameters cache for an app
 */
function setCachedParameters(
  appId: string,
  data: DifyAppParametersResponse | null,
  source: 'database'
) {
  parametersCache[appId] = {
    data,
    timestamp: Date.now(),
    source,
  };
}

class AppParametersService {
  /**
   * Get app parameters in database-only mode
   * @param instanceId - App instance ID
   * @returns Result of app parameters, returns null if no data
   */
  async getAppParameters(
    instanceId: string
  ): Promise<Result<DifyAppParametersResponse | null>> {
    try {
      // 1. Check in-memory cache
      const cached = getCachedParameters(instanceId);
      if (cached) {
        console.log(
          '[AppParametersService] Using cached app parameters:',
          instanceId
        );
        return success(cached);
      }

      // 2. Fetch from database only
      console.log(
        '[AppParametersService] Fetching app parameters from database:',
        instanceId
      );
      const dbResult = await getAppParametersFromDb(instanceId);

      if (dbResult.success && dbResult.data) {
        const difyParameters = convertDatabaseConfigToDifyParameters(
          dbResult.data
        );
        if (difyParameters) {
          console.log(
            '[AppParametersService] Successfully got parameters from database:',
            instanceId
          );
          setCachedParameters(instanceId, difyParameters, 'database');
          return success(difyParameters);
        }
      }

      // 3. No data in database, return null (no fallback to API)
      console.log(
        '[AppParametersService] No app parameters in database, returning null:',
        instanceId
      );
      return success(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get app parameters';
      console.error(
        '[AppParametersService] Failed to get app parameters:',
        error
      );
      return failure(new Error(errorMessage));
    }
  }
}

// Export singleton instance
export const appParametersService = new AppParametersService();
