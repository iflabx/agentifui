'use client';

import { ApiConfigFields } from '@components/admin/api-config/api-config-fields';
import { CustomProviderSelector } from '@components/admin/api-config/custom-provider-selector';
import { DifyAppTypeSelector } from '@components/admin/api-config/dify-app-type-selector';
import DifyParametersPanel from '@components/admin/api-config/dify-parameters-panel';
import { EmptyState } from '@components/admin/api-config/empty-state';
import { FormActions } from '@components/admin/api-config/form-actions';
import { InstanceDetailHeader } from '@components/admin/api-config/instance-detail-header';
import { InstanceFormContainer } from '@components/admin/api-config/instance-form-container';
import {
  handleCreateInstance,
  handleUpdateInstance,
} from '@components/admin/api-config/instance-save-handlers';
import { ProviderManagementModal } from '@components/admin/api-config/provider-management';
import { ProviderManagementButton } from '@components/admin/api-config/provider-management-button';
import { TagsSelector } from '@components/admin/api-config/tags-selector';
import { useApiConfigEvents } from '@components/admin/api-config/use-api-config-events';
import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import { validateDifyFormData } from '@lib/services/dify/validation';
import {
  ServiceInstance,
  useApiConfigStore,
} from '@lib/stores/api-config-store';
import type { DifyAppType } from '@lib/types/dify-app-types';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';
import { cn } from '@lib/utils';
import {
  AlertCircle,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sliders,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface InstanceFormData extends Omit<Partial<ServiceInstance>, 'config'> {
  apiKey?: string;
  config: {
    api_url: string;
    app_metadata: {
      app_type: 'model' | 'marketplace';
      dify_apptype: DifyAppType;
      tags: string[];
    };
    dify_parameters: DifyParametersSimplifiedConfig;
  };
}

interface DifyAppInfo {
  name: string;
  description: string;
  tags: string[];
}

const InstanceForm = ({
  instance,
  isEditing,
  onSave,
  onCancel,
  isProcessing,
  defaultProviderId,
}: {
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
}) => {
  const { serviceInstances, apiKeys, providers } = useApiConfigStore();
  const t = useTranslations('pages.admin.apiConfig.page');
  const tDifyParametersPanel = useTranslations(
    'pages.admin.apiConfig.difyParametersPanel'
  );
  const tButtons = useTranslations('buttons');
  const tConfirm = useTranslations('confirmDialog');

  // provider selection state for new mode
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  // listen to provider selection change, automatically update API URL
  useEffect(() => {
    if (!isEditing && selectedProviderId) {
      const selectedProvider = providers.find(p => p.id === selectedProviderId);
      if (selectedProvider && selectedProvider.base_url) {
        setFormData(prev => ({
          ...prev,
          config: {
            ...prev.config,
            api_url: selectedProvider.base_url,
          },
        }));
      }
    }
  }, [selectedProviderId, providers, isEditing]);

  // get current instance's latest state
  const currentInstance = instance
    ? serviceInstances.find(inst => inst.id === instance.id)
    : null;
  const isCurrentDefault = currentInstance?.is_default || false;

  // check if current instance is configured with API key
  const hasApiKey = instance
    ? apiKeys.some(key => key.service_instance_id === instance.id)
    : false;

  const [formData, setFormData] = useState({
    instance_id: instance?.instance_id || '',
    display_name: instance?.display_name || '',
    description: instance?.description || '',
    api_path: instance?.api_path || '',
    apiKey: '',
    config: {
      api_url: instance?.config?.api_url || '',
      app_metadata: {
        app_type:
          (instance?.config?.app_metadata?.app_type as
            | 'model'
            | 'marketplace') || 'model',
        dify_apptype:
          (instance?.config?.app_metadata?.dify_apptype as
            | 'chatbot'
            | 'agent'
            | 'chatflow'
            | 'workflow'
            | 'text-generation') || 'chatbot',
        tags: instance?.config?.app_metadata?.tags || [],
      },
      dify_parameters: instance?.config?.dify_parameters || {},
    },
  });

  // baseline data state, used to correctly determine if there are unsaved changes
  // when syncing parameters or resetting form, this baseline data needs to be updated
  const [baselineData, setBaselineData] = useState({
    instance_id: instance?.instance_id || '',
    display_name: instance?.display_name || '',
    description: instance?.description || '',
    api_path: instance?.api_path || '',
    apiKey: '',
    config: {
      api_url: instance?.config?.api_url || '',
      app_metadata: {
        app_type:
          (instance?.config?.app_metadata?.app_type as
            | 'model'
            | 'marketplace') || 'model',
        dify_apptype:
          (instance?.config?.app_metadata?.dify_apptype as
            | 'chatbot'
            | 'agent'
            | 'chatflow'
            | 'workflow'
            | 'text-generation') || 'chatbot',
        tags: instance?.config?.app_metadata?.tags || [],
      },
      dify_parameters: instance?.config?.dify_parameters || {},
    },
  });

  const [showDifyPanel, setShowDifyPanel] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // real-time validation of instance_id format
  const [instanceIdError, setInstanceIdError] = useState<string>('');

  // real-time validation of instance_id format
  const validateInstanceId = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setInstanceIdError('');
        return;
      }

      const instanceId = value.trim();

      // check if it contains spaces
      if (instanceId.includes(' ')) {
        setInstanceIdError(t('validation.instanceId.noSpaces'));
        return;
      }

      // check if it contains other special characters that need URL encoding
      const urlUnsafeChars = /[^a-zA-Z0-9\-_\.]/;
      if (urlUnsafeChars.test(instanceId)) {
        setInstanceIdError(t('validation.instanceId.invalidChars'));
        return;
      }

      // check length limit
      if (instanceId.length > 50) {
        setInstanceIdError(t('validation.instanceId.tooLong'));
        return;
      }

      // check if it starts with a letter or number
      if (!/^[a-zA-Z0-9]/.test(instanceId)) {
        setInstanceIdError(
          t('validation.instanceId.mustStartWithAlphanumeric')
        );
        return;
      }

      // all validation passed
      setInstanceIdError('');
    },
    [t]
  );

  useEffect(() => {
    const newData = {
      instance_id: instance?.instance_id || '',
      display_name: instance?.display_name || '',
      description: instance?.description || '',
      api_path: instance?.api_path || '',
      apiKey: '',
      config: {
        api_url: instance?.config?.api_url || '',
        app_metadata: {
          app_type:
            (instance?.config?.app_metadata?.app_type as
              | 'model'
              | 'marketplace') || 'model',
          dify_apptype:
            (instance?.config?.app_metadata?.dify_apptype as
              | 'chatbot'
              | 'agent'
              | 'chatflow'
              | 'workflow'
              | 'text-generation') || 'chatbot',
          tags: instance?.config?.app_metadata?.tags || [],
        },
        dify_parameters: instance?.config?.dify_parameters || {},
      },
    };

    if (instance) {
      // edit mode: if API URL is empty, use provider's base_url
      if (!newData.config.api_url && instance.provider_id) {
        const currentProvider = providers.find(
          p => p.id === instance.provider_id
        );
        if (currentProvider && currentProvider.base_url) {
          newData.config.api_url = currentProvider.base_url;
        }
      }

      setFormData(newData);
      setBaselineData(newData);
      // validate instance_id format when initializing
      validateInstanceId(newData.instance_id);
    } else {
      // new mode: initialize default provider selection
      // use filtered provider first, then Dify, then the first active provider
      const getInitialProviderId = () => {
        const activeProviders = providers.filter(p => p.is_active);
        if (activeProviders.length === 0) return '';

        // if there is a filtered provider and it is active, use it first
        if (defaultProviderId) {
          const filteredProvider = activeProviders.find(
            p => p.id === defaultProviderId
          );
          if (filteredProvider) return filteredProvider.id;
        }

        if (activeProviders.length === 1) return activeProviders[0].id;
        const difyProvider = activeProviders.find(
          p => p.name.toLowerCase() === 'dify'
        );
        return difyProvider ? difyProvider.id : activeProviders[0].id;
      };

      const initialProviderId = getInitialProviderId();
      setSelectedProviderId(initialProviderId);

      const emptyData = {
        instance_id: '',
        display_name: '',
        description: '',
        api_path: '',
        apiKey: '',
        config: {
          api_url: '',
          app_metadata: {
            app_type: 'model' as const,
            dify_apptype: 'chatbot' as const,
            tags: [],
          },
          dify_parameters: {},
        },
      };
      setFormData(emptyData);
      setBaselineData(emptyData);
      // clear error state when creating
      setInstanceIdError('');
    }
  }, [instance, providers, defaultProviderId, validateInstanceId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // check real-time validation error
    if (instanceIdError) {
      toast.error(t('validation.instanceId.formatError'), {
        description: instanceIdError,
      });
      return;
    }

    // form validation, ensure Dify app type is required
    const validationErrors = validateDifyFormData(formData);
    if (validationErrors.length > 0) {
      toast.error(t('validation.formValidationFailed'), {
        description: validationErrors.join('\n'),
      });
      return;
    }

    // automatically set is_marketplace_app field to be consistent with app_type
    const dataToSave = {
      ...formData,
      // ensure instance_id removes leading and trailing spaces
      instance_id: formData.instance_id.trim(),
      config: {
        ...formData.config,
        app_metadata: {
          ...formData.config.app_metadata,
          // ensure dify_apptype field is saved
          dify_apptype: formData.config.app_metadata.dify_apptype,
          is_marketplace_app:
            formData.config.app_metadata.app_type === 'marketplace',
        },
      },
      setAsDefault,
      // pass selected provider ID when creating
      selectedProviderId: isEditing ? undefined : selectedProviderId,
    };

    onSave(dataToSave);
  };

  const handleDifyParametersSave = (
    difyConfig: DifyParametersSimplifiedConfig
  ) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        dify_parameters: difyConfig,
      },
    }));

    // update baseline data after Dify parameters are saved
    setBaselineData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        dify_parameters: difyConfig,
      },
    }));

    setShowDifyPanel(false);
  };

  // smart sync parameters logic
  // edit mode: use database config first, fallback to form config if failed
  // add mode: use form config directly
  const handleSyncFromDify = async () => {
    // new mode needs API URL and API Key, edit mode needs instance_id
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
      // sync basic config info (name, description, tags)
      let appInfo: DifyAppInfo | null = null;
      let difyParams: DifyAppParametersResponse | null = null;
      let actualInstanceId = formData.instance_id;
      let isAutoGenerated = false;

      if (isEditing) {
        // edit mode: use database config first
        try {
          console.log('[sync config] edit mode: try to use database config');

          // get basic info and parameters
          const { getDifyAppInfo, getDifyAppParameters } = await import(
            '@lib/services/dify/app-browser-service'
          );
          appInfo = await getDifyAppInfo(formData.instance_id);
          difyParams = await getDifyAppParameters(formData.instance_id);
        } catch (dbError) {
          console.log(
            '[sync config] database config failed, try to use form config:',
            dbError
          );

          // support using form config for sync in edit mode
          // so user can test immediately after modifying API Key
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

          // use form config as fallback
          const { getDifyAppInfoWithConfig, getDifyAppParametersWithConfig } =
            await import('@lib/services/dify/app-browser-service');

          // get basic info and parameters
          appInfo = await getDifyAppInfoWithConfig(formData.instance_id, {
            apiUrl: formData.config.api_url,
            apiKey: formData.apiKey,
          });
          difyParams = await getDifyAppParametersWithConfig(
            formData.instance_id,
            {
              apiUrl: formData.config.api_url,
              apiKey: formData.apiKey,
            }
          );
        }
      } else {
        // add mode: use form config directly
        console.log('[sync config] add mode: use form config');

        // check if form config is complete
        if (!formData.config.api_url || !formData.apiKey) {
          toast.warning(t('validation.fillApiCredentials'));
          return;
        }

        // if application ID is empty, generate a temporary UUID for testing
        // so user can test API config immediately, without pre-thinking application ID
        if (!actualInstanceId) {
          actualInstanceId = uuidv4();
          isAutoGenerated = true;
          console.log(
            '[sync config] application ID is empty, generate temporary ID:',
            actualInstanceId
          );
        }

        // use form config directly
        const { getDifyAppInfoWithConfig, getDifyAppParametersWithConfig } =
          await import('@lib/services/dify/app-browser-service');

        // get basic info and parameters
        appInfo = await getDifyAppInfoWithConfig(actualInstanceId, {
          apiUrl: formData.config.api_url,
          apiKey: formData.apiKey,
        });
        difyParams = await getDifyAppParametersWithConfig(actualInstanceId, {
          apiUrl: formData.config.api_url,
          apiKey: formData.apiKey,
        });
      }

      // sync basic info
      const updatedFormData = { ...formData };

      if (appInfo) {
        // always sync basic info, but give user the choice
        // no longer limit only empty fields to sync, improve the practicality of sync function
        // sync display_name (if changed, ask user for confirmation)
        if (appInfo.name && appInfo.name !== formData.display_name) {
          if (
            !formData.display_name ||
            confirm(tConfirm('updateDisplayName', { name: appInfo.name }))
          ) {
            updatedFormData.display_name = appInfo.name;
          }
        }

        // sync description (if changed, ask user for confirmation)
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

        // sync tags (append mode, do not replace existing tags)
        if (appInfo.tags && appInfo.tags.length > 0) {
          const currentTags = formData.config.app_metadata.tags || [];
          const newTags = appInfo.tags.filter(
            (tag: string) => !currentTags.includes(tag)
          );

          if (newTags.length > 0) {
            updatedFormData.config.app_metadata.tags = [
              ...currentTags,
              ...newTags,
            ];
          }
        }
      }

      // sync parameters
      if (difyParams) {
        const simplifiedParams: DifyParametersSimplifiedConfig = {
          opening_statement: difyParams.opening_statement || '',
          suggested_questions: difyParams.suggested_questions || [],
          suggested_questions_after_answer:
            difyParams.suggested_questions_after_answer || { enabled: false },
          speech_to_text: difyParams.speech_to_text || { enabled: false },
          text_to_speech: difyParams.text_to_speech || { enabled: false },
          retriever_resource: difyParams.retriever_resource || {
            enabled: false,
          },
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

        updatedFormData.config.dify_parameters = simplifiedParams;
      }

      // if the ID is auto-generated, fill it into the form after sync
      if (!isEditing && isAutoGenerated && actualInstanceId) {
        updatedFormData.instance_id = actualInstanceId;
        // validate auto-generated ID
        validateInstanceId(actualInstanceId);
      }

      // update form data
      setFormData(updatedFormData);

      // update baseline data after sync
      setBaselineData(updatedFormData);

      // add data validation, ensure really getting data before showing success
      const syncedItems = [];
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
      console.error('[sync config] sync failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : t('sync.syncFailed');
      toast.error(t('sync.syncFailedTitle'), { description: errorMessage });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'mb-6 rounded-xl border p-6',
          'border-stone-200 bg-white dark:border-stone-600 dark:bg-stone-800'
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3
              className={cn(
                'font-serif text-lg font-bold',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {isEditing ? t('title.edit') : t('title.add')}
            </h3>

            {/* Unsaved changes indicator */}
            {(JSON.stringify(formData) !== JSON.stringify(baselineData) ||
              formData.apiKey) && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 font-serif text-xs font-medium',
                  'animate-pulse border border-dashed border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300'
                )}
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    'bg-amber-500 dark:bg-amber-400'
                  )}
                />
                {t('unsavedChanges')}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* set as default app button */}
            {isEditing ? (
              /* edit mode: display current state and allow modification */
              instance && (
                <button
                  type="button"
                  onClick={() => {
                    if (isCurrentDefault) {
                      return; // already a default app, no need to operate
                    }

                    if (
                      confirm(
                        t('defaultApp.setDefaultConfirm', {
                          name: formData.display_name || 'this app',
                        })
                      )
                    ) {
                      // directly call the store method
                      if (instance.id) {
                        useApiConfigStore
                          .getState()
                          .setDefaultInstance(instance.id)
                          .then(() => {
                            toast.success(t('defaultApp.setDefaultSuccess'));
                          })
                          .catch(error => {
                            console.error('Failed to set default app:', error);
                            toast.error(t('defaultApp.setDefaultFailed'));
                          });
                      } else {
                        toast.error(t('defaultApp.instanceNotFound'));
                      }
                    }
                  }}
                  disabled={isCurrentDefault}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 transition-all',
                    'border',
                    isCurrentDefault
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:scale-105',
                    isCurrentDefault
                      ? 'border-stone-300/50 bg-stone-100/50 text-stone-500 dark:border-stone-600/50 dark:bg-stone-700/30 dark:text-stone-400'
                      : 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
                  )}
                >
                  <Star
                    className={cn(
                      'h-4 w-4',
                      isCurrentDefault && 'fill-current'
                    )}
                  />
                  <span className="font-serif text-sm font-medium">
                    {isCurrentDefault
                      ? t('defaultApp.isDefault')
                      : t('defaultApp.setAsDefault')}
                  </span>
                </button>
              )
            ) : (
              /* add mode: allow selecting whether to set as default */
              <button
                type="button"
                onClick={() => setSetAsDefault(!setAsDefault)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all',
                  'border hover:scale-105',
                  setAsDefault
                    ? 'border-stone-400 bg-stone-200 text-stone-800 dark:border-stone-500 dark:bg-stone-600 dark:text-stone-200'
                    : 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
                )}
              >
                <Star
                  className={cn('h-4 w-4', setAsDefault && 'fill-current')}
                />
                <span className="font-serif text-sm font-medium">
                  {setAsDefault
                    ? t('defaultApp.willSetAsDefault')
                    : t('defaultApp.setAsDefault')}
                </span>
              </button>
            )}

            {/* Dify parameters configuration button group */}
            <div
              className={cn(
                'flex gap-2 rounded-lg p-2',
                'bg-stone-100/50 dark:bg-stone-800/50'
              )}
            >
              <button
                type="button"
                onClick={() => setShowDifyPanel(true)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 transition-all',
                  'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-stone-800 dark:bg-stone-700/50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
                )}
              >
                <Sliders className="h-4 w-4" />
                <span className="font-serif text-sm font-medium">
                  {t('difyConfig.title')}
                </span>
              </button>

              {/* Sync parameters from Dify API button */}
              <button
                type="button"
                onClick={handleSyncFromDify}
                disabled={
                  isSyncing ||
                  (!isEditing && (!formData.config.api_url || !formData.apiKey))
                }
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 transition-all',
                  isSyncing ||
                    (!isEditing &&
                      (!formData.config.api_url || !formData.apiKey))
                    ? 'cursor-not-allowed border border-stone-200 bg-stone-200/50 text-stone-400 dark:bg-stone-800/50 dark:text-stone-500'
                    : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-stone-800 dark:bg-stone-700/50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
                )}
                title={
                  isEditing
                    ? tButtons('tooltip.syncFromDifyEdit')
                    : !formData.config.api_url || !formData.apiKey
                      ? tButtons('tooltip.fillCredentials')
                      : tButtons('tooltip.syncFromDifyCreate')
                }
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="font-serif text-sm font-medium">
                  {isSyncing
                    ? tButtons('syncInProgress')
                    : tButtons('syncConfig')}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Service provider selection/display area */}
        <div
          className={cn(
            'mb-6 rounded-lg border p-4',
            'border-stone-200 bg-stone-50 dark:border-stone-600 dark:bg-stone-700/50'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3
                className={cn(
                  'font-serif text-sm font-medium',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {t('provider.title')}
              </h3>
              <p
                className={cn(
                  'mt-1 font-serif text-xs',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {isEditing ? t('provider.current') : t('provider.select')}
              </p>
            </div>

            {isEditing ? (
              /* edit mode: only display, cannot modify */
              <div
                className={cn(
                  'rounded-md px-3 py-1.5 font-serif text-sm',
                  'bg-stone-200 text-stone-700 dark:bg-stone-600 dark:text-stone-200'
                )}
              >
                {(() => {
                  const currentProvider = providers.find(
                    p => p.id === instance?.provider_id
                  );
                  return currentProvider
                    ? currentProvider.name
                    : t('provider.unknown');
                })()}
              </div>
            ) : (
              /* add mode: allow selecting */
              <div className="w-48">
                <CustomProviderSelector
                  providers={providers}
                  selectedProviderId={selectedProviderId}
                  onProviderChange={setSelectedProviderId}
                  placeholder={t('provider.selectPlaceholder')}
                />
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('fields.instanceId.label')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.instance_id}
                  onChange={e => {
                    setFormData(prev => ({
                      ...prev,
                      instance_id: e.target.value,
                    }));
                    validateInstanceId(e.target.value);
                  }}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 font-serif',
                    !isEditing && 'pr-20', // add mode: leave space for button
                    'border-stone-300 bg-white text-stone-900 placeholder-stone-500 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100 dark:placeholder-stone-400',
                    isEditing &&
                      'cursor-not-allowed bg-stone-100 dark:bg-stone-800',
                    instanceIdError && 'border-red-500'
                  )}
                  placeholder={t('fields.instanceId.placeholder')}
                  required
                  disabled={isEditing}
                />

                {/* UUID generation button (only shown in create mode) */}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      const uuid = uuidv4();
                      setFormData(prev => ({ ...prev, instance_id: uuid }));
                      validateInstanceId(uuid);
                    }}
                    className={cn(
                      'absolute top-1/2 right-2 -translate-y-1/2 transform',
                      'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all',
                      'border shadow-sm hover:scale-105 hover:shadow-md',
                      'font-serif font-medium',
                      'border-stone-300 bg-gradient-to-r from-stone-100 to-stone-200 text-stone-700 hover:from-stone-200 hover:to-stone-300 hover:text-stone-800 dark:border-stone-500 dark:bg-gradient-to-r dark:from-stone-600 dark:to-stone-700 dark:text-stone-200 dark:hover:from-stone-500 dark:hover:to-stone-600 dark:hover:text-white'
                    )}
                    title={t('fields.instanceId.generateTooltip')}
                  >
                    <Lightbulb className="h-3 w-3" />
                    <span>{t('fields.instanceId.generateButton')}</span>
                  </button>
                )}
              </div>
              {isEditing && (
                <p
                  className={cn(
                    'mt-1 font-serif text-xs',
                    'text-stone-500 dark:text-stone-400'
                  )}
                >
                  {t('validation.instanceId.notModifiable')}
                </p>
              )}

              {!isEditing && (
                <p
                  className={cn(
                    'mt-1 font-serif text-xs',
                    'text-stone-500 dark:text-stone-400'
                  )}
                >
                  {t('validation.instanceId.formatDescription')}
                </p>
              )}

              {/* Real-time error message */}
              {instanceIdError && (
                <p
                  className={cn(
                    'mt-1 flex items-center gap-1 font-serif text-xs text-red-500'
                  )}
                >
                  <AlertCircle className="h-3 w-3" />
                  {instanceIdError}
                </p>
              )}
            </div>

            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('fields.displayName.label')}
              </label>
              <input
                type="text"
                value={formData.display_name}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    display_name: e.target.value,
                  }))
                }
                className={cn(
                  'w-full rounded-lg border px-3 py-2 font-serif',
                  'border-stone-300 bg-white text-stone-900 placeholder-stone-500 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100 dark:placeholder-stone-400'
                )}
                placeholder={t('fields.displayName.placeholder')}
                required
              />
            </div>
          </div>

          {/* API config fields */}
          <ApiConfigFields
            formData={formData}
            setFormData={setFormData}
            isEditing={isEditing}
            hasApiKey={hasApiKey}
            instance={instance}
            providers={providers}
            selectedProviderId={selectedProviderId}
          />

          {/* Sync configuration button - only shown in create mode */}
          {!isEditing && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleSyncFromDify}
                disabled={
                  isSyncing || !formData.config.api_url || !formData.apiKey
                }
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-serif font-medium transition-colors disabled:opacity-50',
                  isSyncing || !formData.config.api_url || !formData.apiKey
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer',
                  'bg-stone-800 text-white hover:bg-stone-700 dark:bg-stone-600 dark:text-white dark:hover:bg-stone-500'
                )}
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isSyncing ? t('sync.syncing') : t('sync.syncFromDify')}
              </button>
            </div>
          )}

          <div>
            <label
              className={cn(
                'mb-2 block font-serif text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('fields.description.label')}
            </label>
            <textarea
              value={formData.description}
              onChange={e =>
                setFormData(prev => ({ ...prev, description: e.target.value }))
              }
              className={cn(
                'w-full rounded-lg border px-3 py-2 font-serif',
                'border-stone-300 bg-white text-stone-900 placeholder-stone-500 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100 dark:placeholder-stone-400'
              )}
              placeholder={t('fields.description.placeholder')}
              rows={3}
            />
          </div>

          <div>
            <label
              className={cn(
                'mb-3 block font-serif text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('appType.label')}
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() =>
                  setFormData(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      app_metadata: {
                        ...prev.config.app_metadata,
                        app_type: 'model',
                      },
                    },
                  }))
                }
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                  formData.config.app_metadata.app_type === 'model'
                    ? 'border-stone-400 bg-stone-100 dark:border-stone-500 dark:bg-stone-700/50'
                    : 'border-stone-300 hover:border-stone-400 dark:border-stone-600 dark:hover:border-stone-500'
                )}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border-2',
                    formData.config.app_metadata.app_type === 'model'
                      ? 'border-stone-600 bg-stone-600 dark:border-stone-400 dark:bg-stone-400'
                      : 'border-stone-400 dark:border-stone-500'
                  )}
                >
                  {formData.config.app_metadata.app_type === 'model' && (
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        'bg-white dark:bg-stone-800'
                      )}
                    />
                  )}
                </div>
                <div>
                  <div
                    className={cn(
                      'font-serif text-sm font-medium',
                      'text-stone-900 dark:text-stone-100'
                    )}
                  >
                    {t('appType.model.title')}
                  </div>
                  <div
                    className={cn(
                      'font-serif text-xs',
                      'text-stone-600 dark:text-stone-400'
                    )}
                  >
                    {t('appType.model.description')}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setFormData(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      app_metadata: {
                        ...prev.config.app_metadata,
                        app_type: 'marketplace',
                      },
                    },
                  }))
                }
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                  formData.config.app_metadata.app_type === 'marketplace'
                    ? 'border-stone-400 bg-stone-100 dark:border-stone-500 dark:bg-stone-700/50'
                    : 'border-stone-300 hover:border-stone-400 dark:border-stone-600 dark:hover:border-stone-500'
                )}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border-2',
                    formData.config.app_metadata.app_type === 'marketplace'
                      ? 'border-stone-600 bg-stone-600 dark:border-stone-400 dark:bg-stone-400'
                      : 'border-stone-400 dark:border-stone-500'
                  )}
                >
                  {formData.config.app_metadata.app_type === 'marketplace' && (
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        'bg-white dark:bg-stone-800'
                      )}
                    />
                  )}
                </div>
                <div>
                  <div
                    className={cn(
                      'font-serif text-sm font-medium',
                      'text-stone-900 dark:text-stone-100'
                    )}
                  >
                    {t('appType.marketplace.title')}
                  </div>
                  <div
                    className={cn(
                      'font-serif text-xs',
                      'text-stone-600 dark:text-stone-400'
                    )}
                  >
                    {t('appType.marketplace.description')}
                  </div>
                </div>
              </button>
            </div>
            <p
              className={cn(
                'mt-2 font-serif text-xs',
                'text-stone-500 dark:text-stone-400'
              )}
            >
              {t('appType.note')}
            </p>
          </div>

          {/* Dify application type selector */}
          <DifyAppTypeSelector
            value={formData.config.app_metadata.dify_apptype}
            onChange={(type: DifyAppType) => {
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
            }}
          />

          {/* application tags configuration - compact design */}
          <TagsSelector
            tags={formData.config.app_metadata.tags}
            onTagsChange={newTags => {
              setFormData(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  app_metadata: {
                    ...prev.config.app_metadata,
                    tags: newTags,
                  },
                },
              }));
            }}
          />

          <FormActions isProcessing={isProcessing} onCancel={onCancel} />
        </form>
      </div>

      {/* Dify parameters configuration panel */}
      <DifyParametersPanel
        isOpen={showDifyPanel}
        onClose={() => setShowDifyPanel(false)}
        config={formData.config.dify_parameters || {}}
        onSave={handleDifyParametersSave}
        instanceName={
          formData.display_name || tDifyParametersPanel('defaultInstanceName')
        }
      />
    </>
  );
};

export default function ApiConfigPage() {
  const {
    providers,
    createAppInstance: addInstance,
    updateAppInstance: updateInstance,
  } = useApiConfigStore();

  const tInstanceSaveHandlers = useTranslations(
    'pages.admin.apiConfig.instanceSaveHandlers'
  );

  const [selectedInstance, setSelectedInstance] =
    useState<ServiceInstance | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [currentFilterProviderId, setCurrentFilterProviderId] = useState<
    string | null
  >(null);

  // use custom Hook to manage event listeners
  useApiConfigEvents({
    showAddForm,
    selectedInstance,
    setSelectedInstance,
    setShowAddForm,
    setCurrentFilterProviderId,
  });

  const handleClearSelection = () => {
    setSelectedInstance(null);
    setShowAddForm(false);
    window.dispatchEvent(
      new CustomEvent('addFormToggled', {
        detail: {
          showAddForm: false,
          selectedInstance: null,
        },
      })
    );
  };

  // Provider management related processing functions
  const handleProviderChange = () => {
    // reload providers data
    window.dispatchEvent(new CustomEvent('reloadProviders'));
    // Note: Toast will be shown by the specific operation (create/update/delete) in the modal
  };

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('addFormToggled', {
        detail: {
          showAddForm,
          selectedInstance,
        },
      })
    );
  }, [showAddForm, selectedInstance]);

  return (
    <div className="flex h-full flex-col">
      {/* provider management button */}
      <ProviderManagementButton onClick={() => setShowProviderModal(true)} />

      {showAddForm ? (
        <InstanceFormContainer>
          <InstanceForm
            instance={null}
            isEditing={false}
            defaultProviderId={currentFilterProviderId}
            onSave={data =>
              handleCreateInstance(
                data,
                providers,
                addInstance,
                setIsProcessing,
                handleClearSelection,
                tInstanceSaveHandlers
              )
            }
            onCancel={handleClearSelection}
            isProcessing={isProcessing}
          />
        </InstanceFormContainer>
      ) : selectedInstance ? (
        <InstanceFormContainer>
          <InstanceDetailHeader
            instance={selectedInstance}
            onClose={handleClearSelection}
          />

          <InstanceForm
            instance={selectedInstance}
            isEditing={true}
            onSave={data =>
              handleUpdateInstance(
                selectedInstance,
                data,
                updateInstance,
                setIsProcessing,
                handleClearSelection,
                tInstanceSaveHandlers
              )
            }
            onCancel={handleClearSelection}
            isProcessing={isProcessing}
          />
        </InstanceFormContainer>
      ) : (
        <EmptyState />
      )}

      {/* provider management modal */}
      <ProviderManagementModal
        open={showProviderModal}
        onOpenChange={setShowProviderModal}
        onProviderChange={handleProviderChange}
      />
    </div>
  );
}
