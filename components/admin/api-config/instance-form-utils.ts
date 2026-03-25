import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { Provider, ServiceInstance } from '@lib/stores/api-config-store';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';

import type {
  InstanceFormData,
  InstanceIdValidationMessages,
} from './instance-form-types';

export function createEmptyInstanceFormData(): InstanceFormData {
  return {
    instance_id: '',
    display_name: '',
    description: '',
    api_path: '',
    apiKey: '',
    config: {
      api_url: '',
      app_metadata: {
        app_type: 'model',
        dify_apptype: 'chatbot',
        tags: [],
      },
      dify_parameters: {},
    },
  };
}

export function createInstanceFormDataFromInstance(
  instance: Partial<ServiceInstance>,
  providers: Provider[]
): InstanceFormData {
  const data: InstanceFormData = {
    instance_id: instance.instance_id || '',
    display_name: instance.display_name || '',
    description: instance.description || '',
    api_path: instance.api_path || '',
    apiKey: '',
    config: {
      api_url: instance.config?.api_url || '',
      app_metadata: {
        app_type:
          (instance.config?.app_metadata?.app_type as
            | 'model'
            | 'marketplace') || 'model',
        dify_apptype:
          (instance.config?.app_metadata?.dify_apptype as
            | 'chatbot'
            | 'agent'
            | 'chatflow'
            | 'workflow'
            | 'text-generation') || 'chatbot',
        tags: instance.config?.app_metadata?.tags || [],
      },
      dify_parameters: instance.config?.dify_parameters || {},
    },
  };

  if (!data.config.api_url && instance.provider_id) {
    const provider = providers.find(item => item.id === instance.provider_id);
    if (provider?.base_url) {
      data.config.api_url = provider.base_url;
    }
  }

  return data;
}

export function getInitialProviderId(
  providers: Provider[],
  defaultProviderId?: string | null
): string {
  const activeProviders = providers.filter(provider => provider.is_active);
  if (activeProviders.length === 0) {
    return '';
  }

  if (defaultProviderId) {
    const filteredProvider = activeProviders.find(
      provider => provider.id === defaultProviderId
    );
    if (filteredProvider) {
      return filteredProvider.id;
    }
  }

  if (activeProviders.length === 1) {
    return activeProviders[0].id;
  }

  const difyProvider = activeProviders.find(
    provider => provider.name.toLowerCase() === 'dify'
  );
  return difyProvider ? difyProvider.id : activeProviders[0].id;
}

export function validateInstanceIdValue(
  value: string,
  messages: InstanceIdValidationMessages
): string {
  if (!value.trim()) {
    return '';
  }

  const instanceId = value.trim();
  if (instanceId.includes(' ')) {
    return messages.noSpaces;
  }

  if (/[^a-zA-Z0-9\-_.]/.test(instanceId)) {
    return messages.invalidChars;
  }

  if (instanceId.length > 50) {
    return messages.tooLong;
  }

  if (!/^[a-zA-Z0-9]/.test(instanceId)) {
    return messages.mustStartWithAlphanumeric;
  }

  return '';
}

export function buildSimplifiedDifyParameters(
  difyParams: DifyAppParametersResponse
): DifyParametersSimplifiedConfig {
  return {
    opening_statement: difyParams.opening_statement || '',
    suggested_questions: difyParams.suggested_questions || [],
    suggested_questions_after_answer:
      difyParams.suggested_questions_after_answer || { enabled: false },
    speech_to_text: difyParams.speech_to_text || { enabled: false },
    text_to_speech: difyParams.text_to_speech || { enabled: false },
    retriever_resource: difyParams.retriever_resource || { enabled: false },
    annotation_reply: difyParams.annotation_reply || { enabled: false },
    user_input_form: difyParams.user_input_form || [],
    file_upload: difyParams.file_upload || undefined,
    system_parameters: difyParams.system_parameters || {
      file_size_limit: 15,
      image_file_size_limit: 10,
      audio_file_size_limit: 50,
      video_file_size_limit: 100,
    },
  };
}
