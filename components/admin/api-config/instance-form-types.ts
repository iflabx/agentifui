import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import type { Provider, ServiceInstance } from '@lib/stores/api-config-store';
import type { DifyAppType } from '@lib/types/dify-app-types';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';

export interface InstanceFormData {
  id?: string;
  provider_id?: string;
  is_default?: boolean;
  visibility?: ServiceInstance['visibility'];
  instance_id: string;
  display_name: string;
  description: string;
  api_path: string;
  apiKey: string;
  config: {
    api_url: string;
    app_metadata: {
      app_type: 'model' | 'marketplace';
      dify_apptype: DifyAppType;
      tags: string[];
      is_marketplace_app?: boolean;
    };
    dify_parameters: DifyParametersSimplifiedConfig;
  };
}

export interface DifyAppInfo {
  name: string;
  description: string;
  tags: string[];
}

export interface InstanceFormProps {
  instance: Partial<ServiceInstance> | null;
  isEditing: boolean;
  onSave: (
    data: InstanceFormData & {
      setAsDefault: boolean;
      selectedProviderId?: string;
    }
  ) => void;
  onCancel: () => void;
  isProcessing: boolean;
  defaultProviderId?: string | null;
}

export interface InstanceIdValidationMessages {
  noSpaces: string;
  invalidChars: string;
  tooLong: string;
  mustStartWithAlphanumeric: string;
}

export type SyncDifyParams = DifyAppParametersResponse;
export type ApiConfigProvider = Provider;
