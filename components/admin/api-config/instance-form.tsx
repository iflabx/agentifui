'use client';

import { ApiConfigFields } from '@components/admin/api-config/api-config-fields';
import { DifyAppTypeSelector } from '@components/admin/api-config/dify-app-type-selector';
import DifyParametersPanel from '@components/admin/api-config/dify-parameters-panel';
import { FormActions } from '@components/admin/api-config/form-actions';
import { InstanceFormHeader } from '@components/admin/api-config/instance-form-header';
import { InstanceIdField } from '@components/admin/api-config/instance-id-field';
import { InstanceProviderCard } from '@components/admin/api-config/instance-provider-card';
import { TagsSelector } from '@components/admin/api-config/tags-selector';
import { cn } from '@lib/utils';

import { useTranslations } from 'next-intl';

import type { InstanceFormProps } from './instance-form-types';
import { useInstanceFormState } from './use-instance-form-state';

export function InstanceForm(props: InstanceFormProps) {
  const { instance, isEditing, onCancel, isProcessing } = props;
  const t = useTranslations('pages.admin.apiConfig.page');
  const panelTranslations = useTranslations(
    'pages.admin.apiConfig.difyParametersPanel'
  );
  const {
    providers,
    formData,
    setFormData,
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
  } = useInstanceFormState(props);

  return (
    <>
      <div
        className={cn(
          'mb-6 rounded-xl border p-6',
          'border-stone-200 bg-white dark:border-stone-600 dark:bg-stone-800'
        )}
      >
        <InstanceFormHeader
          isEditing={isEditing}
          instanceId={instance?.id}
          instanceName={formData.display_name || 'this app'}
          isCurrentDefault={isCurrentDefault}
          setAsDefault={setAsDefault}
          onToggleSetAsDefault={() => setSetAsDefault(!setAsDefault)}
          hasUnsavedChanges={hasUnsavedChanges}
          isSyncing={isSyncing}
          canSync={
            isEditing || Boolean(formData.config.api_url && formData.apiKey)
          }
          onOpenDifyPanel={() => setShowDifyPanel(true)}
          onSyncFromDify={handleSyncFromDify}
        />

        <InstanceProviderCard
          isEditing={isEditing}
          providers={providers}
          selectedProviderId={selectedProviderId}
          currentProviderName={currentProviderName}
          onProviderChange={setSelectedProviderId}
        />

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <InstanceIdField
              value={formData.instance_id}
              isEditing={isEditing}
              error={instanceIdError}
              onChange={value => {
                setFormData(prev => ({ ...prev, instance_id: value }));
                validateInstanceId(value);
              }}
            />

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
                onChange={event =>
                  setFormData(prev => ({
                    ...prev,
                    display_name: event.target.value,
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

          <ApiConfigFields
            formData={formData}
            setFormData={setFormData}
            isEditing={isEditing}
            hasApiKey={hasApiKey}
            instance={instance}
            providers={providers}
            selectedProviderId={selectedProviderId}
          />

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
              onChange={event =>
                setFormData(prev => ({
                  ...prev,
                  description: event.target.value,
                }))
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
              {(['model', 'marketplace'] as const).map(appType => {
                const selected =
                  formData.config.app_metadata.app_type === appType;
                return (
                  <button
                    key={appType}
                    type="button"
                    onClick={() => updateAppType(appType)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                      selected
                        ? 'border-stone-400 bg-stone-100 dark:border-stone-500 dark:bg-stone-700/50'
                        : 'border-stone-300 hover:border-stone-400 dark:border-stone-600 dark:hover:border-stone-500'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border-2',
                        selected
                          ? 'border-stone-600 bg-stone-600 dark:border-stone-400 dark:bg-stone-400'
                          : 'border-stone-400 dark:border-stone-500'
                      )}
                    >
                      {selected && (
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
                        {t(`appType.${appType}.title`)}
                      </div>
                      <div
                        className={cn(
                          'font-serif text-xs',
                          'text-stone-600 dark:text-stone-400'
                        )}
                      >
                        {t(`appType.${appType}.description`)}
                      </div>
                    </div>
                  </button>
                );
              })}
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

          <DifyAppTypeSelector
            value={formData.config.app_metadata.dify_apptype}
            onChange={updateDifyAppType}
          />

          <TagsSelector
            tags={formData.config.app_metadata.tags}
            onTagsChange={updateTags}
          />

          <FormActions isProcessing={isProcessing} onCancel={onCancel} />
        </form>
      </div>

      <DifyParametersPanel
        isOpen={showDifyPanel}
        onClose={() => setShowDifyPanel(false)}
        config={formData.config.dify_parameters || {}}
        onSave={handleDifyParametersSave}
        instanceName={
          formData.display_name || panelTranslations('defaultInstanceName')
        }
      />
    </>
  );
}
