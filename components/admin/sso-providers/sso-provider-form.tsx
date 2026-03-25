'use client';

import { useTheme } from '@lib/hooks/use-theme';
import { useSsoProvidersStore } from '@lib/stores/sso-providers-store';
import type { SsoProtocol } from '@lib/types/database';
import { cn } from '@lib/utils';
import { Loader2, Save, Shield, X } from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import { SsoProviderBasicTab } from './sso-provider-form/basic-tab';
import {
  createSsoProviderTabs,
  getDefaultSettings,
  protocolIcons,
} from './sso-provider-form/constants';
import { SsoProviderProtocolTab } from './sso-provider-form/protocol-tab';
import { SsoProviderRawJsonEditor } from './sso-provider-form/raw-json-editor';
import { SsoProviderSecurityTab } from './sso-provider-form/security-tab';
import { SsoProviderSidebar } from './sso-provider-form/sidebar';
import type {
  SsoProviderFormProps,
  SsoProviderTabId,
} from './sso-provider-form/types';
import { SsoProviderUiTab } from './sso-provider-form/ui-tab';
import {
  createDefaultSsoProviderFormData,
  createSsoProviderFormDataFromProvider,
  parseSsoProviderSettingsJson,
  stringifySsoProviderSettings,
  updateSsoProviderSettings,
} from './sso-provider-form/utils';

export function SsoProviderForm({
  isOpen,
  mode,
  provider,
  onClose,
}: SsoProviderFormProps) {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.ssoProviders.form');
  const { addProvider, editProvider, loading } = useSsoProvidersStore();

  const [formData, setFormData] = useState(() =>
    createDefaultSsoProviderFormData()
  );
  const [activeTab, setActiveTab] = useState<SsoProviderTabId>('basic');
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonValue, setRawJsonValue] = useState(() =>
    stringifySsoProviderSettings(getDefaultSettings('CAS'))
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const tabs = useMemo(() => createSsoProviderTabs(t), [t]);

  useEffect(() => {
    if (mode === 'edit' && provider) {
      const nextFormData = createSsoProviderFormDataFromProvider(provider);
      setFormData(nextFormData);
      setRawJsonValue(stringifySsoProviderSettings(nextFormData.settings));
      setJsonError(null);
      return;
    }

    const nextFormData = createDefaultSsoProviderFormData();
    setFormData(nextFormData);
    setRawJsonValue(stringifySsoProviderSettings(nextFormData.settings));
    setJsonError(null);
  }, [mode, provider]);

  const handleProtocolChange = (protocol: SsoProtocol) => {
    const nextSettings = getDefaultSettings(protocol);
    setFormData(prev => ({
      ...prev,
      protocol,
      settings: nextSettings,
    }));
    setRawJsonValue(stringifySsoProviderSettings(nextSettings));
    setJsonError(null);
  };

  const handleSettingsChange = (path: string, value: unknown) => {
    const nextSettings = updateSsoProviderSettings(
      formData.settings,
      path,
      value
    );
    setFormData(prev => ({
      ...prev,
      settings: nextSettings,
    }));
    setRawJsonValue(stringifySsoProviderSettings(nextSettings));
  };

  const handleRawJsonChange = (value: string) => {
    setRawJsonValue(value);
    const parsed = parseSsoProviderSettingsJson(value);
    if (parsed.error) {
      setJsonError(parsed.error);
      return;
    }
    if (!parsed.settings) {
      return;
    }

    setFormData(prev => ({
      ...prev,
      settings: parsed.settings,
    }));
    setJsonError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (jsonError) {
      toast.error(t('messages.fixJsonErrors'));
      return;
    }

    try {
      let success = false;

      if (mode === 'create') {
        success = await addProvider(formData);
        if (success) {
          toast.success(t('messages.createSuccess'));
        }
      } else if (mode === 'edit' && provider) {
        success = await editProvider(provider.id, formData);
        if (success) {
          toast.success(t('messages.updateSuccess'));
        }
      }

      if (success) {
        handleClose();
      }
    } catch {
      toast.error(t('messages.unexpectedError'));
    }
  };

  const handleClose = () => {
    onClose();
    setActiveTab('basic');
    setShowRawJson(false);
    setJsonError(null);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div
        className={cn(
          'relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border shadow-2xl',
          isDark ? 'border-stone-700 bg-stone-900' : 'border-stone-200 bg-white'
        )}
      >
        <div
          className={cn(
            'border-b px-6 py-4 backdrop-blur-sm',
            isDark ? 'border-stone-700/50' : 'border-stone-200/50'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full',
                  isDark ? 'bg-stone-700/50' : 'bg-stone-100'
                )}
              >
                <Shield
                  className={cn(
                    'h-5 w-5',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                />
              </div>
              <div>
                <h2
                  className={cn(
                    'font-serif text-xl font-semibold',
                    isDark ? 'text-stone-100' : 'text-stone-900'
                  )}
                >
                  {mode === 'create' ? t('createTitle') : t('editTitle')}
                </h2>
                <p
                  className={cn(
                    'font-serif text-sm',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                >
                  {mode === 'create'
                    ? t('createDescription')
                    : t('editDescription')}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className={cn(
                'rounded-lg p-2 transition-colors',
                isDark
                  ? 'text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-700'
              )}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex h-[calc(90vh-140px)]">
          <SsoProviderSidebar
            activeTab={activeTab}
            isDark={isDark}
            showRawJson={showRawJson}
            tabs={tabs}
            onSelectTab={setActiveTab}
            onToggleRawJson={() => setShowRawJson(prev => !prev)}
            t={t}
          />

          <div className="flex-1 overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6">
              {showRawJson ? (
                <SsoProviderRawJsonEditor
                  isDark={isDark}
                  jsonError={jsonError}
                  onChange={handleRawJsonChange}
                  t={t}
                  value={rawJsonValue}
                />
              ) : (
                <div className="space-y-6">
                  {activeTab === 'basic' && (
                    <SsoProviderBasicTab
                      isDark={isDark}
                      t={t}
                      formData={formData}
                      setFormData={setFormData}
                      handleProtocolChange={handleProtocolChange}
                      handleSettingsChange={handleSettingsChange}
                      protocolIcons={protocolIcons}
                    />
                  )}
                  {activeTab === 'protocol' && (
                    <SsoProviderProtocolTab
                      isDark={isDark}
                      t={t}
                      formData={formData}
                      handleSettingsChange={handleSettingsChange}
                    />
                  )}
                  {activeTab === 'security' && (
                    <SsoProviderSecurityTab
                      isDark={isDark}
                      t={t}
                      formData={formData}
                      handleSettingsChange={handleSettingsChange}
                    />
                  )}
                  {activeTab === 'ui' && (
                    <SsoProviderUiTab
                      isDark={isDark}
                      t={t}
                      formData={formData}
                      handleSettingsChange={handleSettingsChange}
                    />
                  )}
                </div>
              )}
            </form>
          </div>
        </div>

        <div
          className={cn(
            'border-t px-6 py-4 backdrop-blur-sm',
            isDark ? 'border-stone-700/50' : 'border-stone-200/50'
          )}
        >
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                'rounded-lg border px-4 py-2 font-serif text-sm transition-colors',
                isDark
                  ? 'border-stone-600 text-stone-300 hover:bg-stone-700/50'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-50'
              )}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={loading.creating || loading.updating || !!jsonError}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 font-serif text-sm text-white transition-colors',
                loading.creating || loading.updating || jsonError
                  ? 'cursor-not-allowed bg-stone-400'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              )}
            >
              {loading.creating || loading.updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {loading.creating || loading.updating
                ? t('actions.saving')
                : t('actions.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
