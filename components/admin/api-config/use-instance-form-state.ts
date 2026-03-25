import { validateDifyFormData } from '@lib/services/dify/validation';
import {
  ServiceInstance,
  useApiConfigStore,
} from '@lib/stores/api-config-store';
import type { DifyAppType } from '@lib/types/dify-app-types';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import type { InstanceFormProps } from './instance-form-types';
import {
  buildSimplifiedDifyParameters,
  createEmptyInstanceFormData,
  createInstanceFormDataFromInstance,
  getInitialProviderId,
  validateInstanceIdValue,
} from './instance-form-utils';

export function useInstanceFormState({
  instance,
  isEditing,
  onSave,
  defaultProviderId,
}: Pick<
  InstanceFormProps,
  'instance' | 'isEditing' | 'onSave' | 'defaultProviderId'
>) {
  const { serviceInstances, apiKeys, providers } = useApiConfigStore();
  const t = useTranslations('pages.admin.apiConfig.page');
  const tConfirm = useTranslations('confirmDialog');
  const tButtons = useTranslations('buttons');
  const tDifyParametersPanel = useTranslations(
    'pages.admin.apiConfig.difyParametersPanel'
  );

  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [formData, setFormData] = useState(createEmptyInstanceFormData());
  const [baselineData, setBaselineData] = useState(
    createEmptyInstanceFormData()
  );
  const [showDifyPanel, setShowDifyPanel] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [instanceIdError, setInstanceIdError] = useState('');

  const currentInstance = instance
    ? serviceInstances.find(item => item.id === instance.id)
    : null;
  const isCurrentDefault = currentInstance?.is_default || false;
  const hasApiKey = instance
    ? apiKeys.some(key => key.service_instance_id === instance.id)
    : false;

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(formData) !== JSON.stringify(baselineData) ||
      Boolean(formData.apiKey),
    [baselineData, formData]
  );

  const currentProviderName = useMemo(() => {
    if (!instance?.provider_id) {
      return t('provider.unknown');
    }

    return (
      providers.find(provider => provider.id === instance.provider_id)?.name ||
      t('provider.unknown')
    );
  }, [instance?.provider_id, providers, t]);

  const validateInstanceId = useCallback(
    (value: string) => {
      setInstanceIdError(
        validateInstanceIdValue(value, {
          noSpaces: t('validation.instanceId.noSpaces'),
          invalidChars: t('validation.instanceId.invalidChars'),
          tooLong: t('validation.instanceId.tooLong'),
          mustStartWithAlphanumeric: t(
            'validation.instanceId.mustStartWithAlphanumeric'
          ),
        })
      );
    },
    [t]
  );

  useEffect(() => {
    if (!isEditing && selectedProviderId) {
      const selectedProvider = providers.find(
        provider => provider.id === selectedProviderId
      );
      if (selectedProvider?.base_url) {
        setFormData(prev => ({
          ...prev,
          config: {
            ...prev.config,
            api_url: selectedProvider.base_url,
          },
        }));
      }
    }
  }, [isEditing, providers, selectedProviderId]);

  useEffect(() => {
    if (instance) {
      const nextData = createInstanceFormDataFromInstance(instance, providers);
      setFormData(nextData);
      setBaselineData(nextData);
      validateInstanceId(nextData.instance_id);
      return;
    }

    const providerId = getInitialProviderId(providers, defaultProviderId);
    setSelectedProviderId(providerId);
    const emptyData = createEmptyInstanceFormData();
    setFormData(emptyData);
    setBaselineData(emptyData);
    setInstanceIdError('');
  }, [defaultProviderId, instance, providers, validateInstanceId]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();

      if (instanceIdError) {
        toast.error(t('validation.instanceId.formatError'), {
          description: instanceIdError,
        });
        return;
      }

      const validationErrors = validateDifyFormData(formData);
      if (validationErrors.length > 0) {
        toast.error(t('validation.formValidationFailed'), {
          description: validationErrors.join('\n'),
        });
        return;
      }

      onSave({
        ...formData,
        instance_id: formData.instance_id.trim(),
        config: {
          ...formData.config,
          app_metadata: {
            ...formData.config.app_metadata,
            dify_apptype: formData.config.app_metadata.dify_apptype,
            is_marketplace_app:
              formData.config.app_metadata.app_type === 'marketplace',
          },
        },
        setAsDefault,
        selectedProviderId: isEditing ? undefined : selectedProviderId,
      });
    },
    [
      formData,
      instanceIdError,
      isEditing,
      onSave,
      selectedProviderId,
      setAsDefault,
      t,
    ]
  );

  const handleDifyParametersSave = useCallback(
    (difyConfig: DifyParametersSimplifiedConfig) => {
      setFormData(prev => ({
        ...prev,
        config: {
          ...prev.config,
          dify_parameters: difyConfig,
        },
      }));
      setBaselineData(prev => ({
        ...prev,
        config: {
          ...prev.config,
          dify_parameters: difyConfig,
        },
      }));
      setShowDifyPanel(false);
    },
    []
  );

  const handleSyncFromDify = useCallback(async () => {
    if (!isEditing && (!formData.config.api_url || !formData.apiKey)) {
      toast.warning(t('validation.fillApiCredentials'));
      return;
    }

    if (isEditing && !formData.instance_id) {
      toast.warning(t('validation.fillInstanceId'));
      return;
    }

    setIsSyncing(true);
    try {
      let appInfo: {
        name: string;
        description: string;
        tags: string[];
      } | null = null;
      let difyParams = null;
      let actualInstanceId = formData.instance_id;
      let isAutoGenerated = false;

      if (isEditing) {
        try {
          const { getDifyAppInfo, getDifyAppParameters } = await import(
            '@lib/services/dify/app-browser-service'
          );
          [appInfo, difyParams] = await Promise.all([
            getDifyAppInfo(formData.instance_id),
            getDifyAppParameters(formData.instance_id),
          ]);
        } catch {
          if (!formData.config.api_url) {
            throw new Error(
              'API URL is empty, cannot sync config. Please fill in API URL or check database config.'
            );
          }
          if (!formData.apiKey) {
            throw new Error(
              'API Key is empty, cannot sync config. Please enter a new key in the API Key field for testing.'
            );
          }

          const { getDifyAppInfoWithConfig, getDifyAppParametersWithConfig } =
            await import('@lib/services/dify/app-browser-service');

          [appInfo, difyParams] = await Promise.all([
            getDifyAppInfoWithConfig(formData.instance_id, {
              apiUrl: formData.config.api_url,
              apiKey: formData.apiKey,
            }),
            getDifyAppParametersWithConfig(formData.instance_id, {
              apiUrl: formData.config.api_url,
              apiKey: formData.apiKey,
            }),
          ]);
        }
      } else {
        if (!actualInstanceId) {
          actualInstanceId = uuidv4();
          isAutoGenerated = true;
        }

        const { getDifyAppInfoWithConfig, getDifyAppParametersWithConfig } =
          await import('@lib/services/dify/app-browser-service');

        [appInfo, difyParams] = await Promise.all([
          getDifyAppInfoWithConfig(actualInstanceId, {
            apiUrl: formData.config.api_url,
            apiKey: formData.apiKey,
          }),
          getDifyAppParametersWithConfig(actualInstanceId, {
            apiUrl: formData.config.api_url,
            apiKey: formData.apiKey,
          }),
        ]);
      }

      const updatedFormData = { ...formData };

      if (appInfo) {
        if (appInfo.name && appInfo.name !== formData.display_name) {
          if (
            !formData.display_name ||
            confirm(tConfirm('updateDisplayName', { name: appInfo.name }))
          ) {
            updatedFormData.display_name = appInfo.name;
          }
        }

        if (
          appInfo.description &&
          appInfo.description !== formData.description
        ) {
          if (
            !formData.description ||
            confirm(
              t('syncConfirm.updateDescription', {
                description: appInfo.description,
              })
            )
          ) {
            updatedFormData.description = appInfo.description;
          }
        }

        if (appInfo.tags?.length) {
          const currentTags = formData.config.app_metadata.tags || [];
          const newTags = appInfo.tags.filter(
            tag => !currentTags.includes(tag)
          );
          if (newTags.length > 0) {
            updatedFormData.config.app_metadata.tags = [
              ...currentTags,
              ...newTags,
            ];
          }
        }
      }

      if (difyParams) {
        updatedFormData.config.dify_parameters =
          buildSimplifiedDifyParameters(difyParams);
      }

      if (!isEditing && isAutoGenerated && actualInstanceId) {
        updatedFormData.instance_id = actualInstanceId;
        validateInstanceId(actualInstanceId);
      }

      setFormData(updatedFormData);
      setBaselineData(updatedFormData);

      const syncedItems = [] as string[];
      if (appInfo) {
        syncedItems.push(t('sync.basicInfo'));
      }
      if (difyParams) {
        syncedItems.push(t('sync.paramConfig'));
      }
      if (syncedItems.length === 0) {
        throw new Error(t('sync.noDataReceived'));
      }

      let successMessage = t('sync.successMessage', {
        items: syncedItems.join(', '),
      });
      if (!isEditing && isAutoGenerated) {
        successMessage += t('sync.autoGeneratedId', {
          instanceId: actualInstanceId,
        });
      }

      toast.success(successMessage);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('sync.syncFailed');
      toast.error(t('sync.syncFailedTitle'), { description: errorMessage });
    } finally {
      setIsSyncing(false);
    }
  }, [formData, isEditing, t, tConfirm, validateInstanceId]);

  const updateAppType = useCallback((appType: 'model' | 'marketplace') => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        app_metadata: {
          ...prev.config.app_metadata,
          app_type: appType,
        },
      },
    }));
  }, []);

  const updateDifyAppType = useCallback((type: DifyAppType) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        app_metadata: {
          ...prev.config.app_metadata,
          dify_apptype: type,
        },
      },
    }));
  }, []);

  const updateTags = useCallback((tags: string[]) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        app_metadata: {
          ...prev.config.app_metadata,
          tags,
        },
      },
    }));
  }, []);

  return {
    providers,
    t,
    tButtons,
    tDifyParametersPanel,
    formData,
    setFormData,
    baselineData,
    selectedProviderId,
    setSelectedProviderId,
    showDifyPanel,
    setShowDifyPanel,
    setAsDefault,
    setSetAsDefault,
    isSyncing,
    instanceIdError,
    validateInstanceId,
    handleSubmit,
    handleDifyParametersSave,
    handleSyncFromDify,
    updateAppType,
    updateDifyAppType,
    updateTags,
    hasUnsavedChanges,
    isCurrentDefault,
    hasApiKey,
    currentProviderName,
  };
}
