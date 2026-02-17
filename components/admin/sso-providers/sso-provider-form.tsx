'use client';

import { useTheme } from '@lib/hooks/use-theme';
import { useSsoProvidersStore } from '@lib/stores/sso-providers-store';
import {
  type CreateSsoProviderData,
  type SsoProtocol,
  type SsoProvider,
  type SsoProviderSettings,
} from '@lib/types/database';
import { cn } from '@lib/utils';
import {
  AlertCircle,
  Code,
  Globe,
  Key,
  Loader2,
  Lock,
  Palette,
  Save,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface SsoProviderFormProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  provider?: SsoProvider | null;
  onClose: () => void;
}

const getDefaultSettings = (protocol: SsoProtocol): SsoProviderSettings => {
  const baseSettings: SsoProviderSettings = {
    protocol_config: {
      base_url: '',
      endpoints: {
        login: '/login',
        logout: '/logout',
        validate: '/serviceValidate',
      },
      attributes_mapping: {
        employee_id: 'cas:user',
        username: 'cas:username',
        full_name: 'cas:name',
        email: 'cas:mail',
      },
    },
    security: {
      require_https: true,
      validate_certificates: true,
      allowed_redirect_hosts: [],
    },
    ui: {
      icon: '🏛️',
      theme: 'primary',
    },
  };

  // Protocol-specific defaults
  switch (protocol) {
    case 'CAS':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          version: '2.0',
          timeout: 10000,
          endpoints: {
            ...baseSettings.protocol_config.endpoints,
            validate_v3: '/p3/serviceValidate',
          },
        },
      };
    case 'OIDC':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          scope: 'openid profile email',
          response_type: 'code',
          attributes_mapping: {
            employee_id: 'sub',
            username: 'preferred_username',
            full_name: 'name',
            email: 'email',
          },
        },
      };
    case 'SAML':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          attributes_mapping: {
            employee_id: 'urn:oid:0.9.2342.19200300.100.1.1',
            username: 'urn:oid:0.9.2342.19200300.100.1.1',
            full_name: 'urn:oid:2.5.4.3',
            email: 'urn:oid:1.2.840.113549.1.9.1',
          },
        },
      };
    default:
      return baseSettings;
  }
};

// Protocol icons
const protocolIcons = {
  CAS: Globe,
  SAML: Key,
  OAuth2: Lock,
  OIDC: Settings,
} as const;

export function SsoProviderForm({
  isOpen,
  mode,
  provider,
  onClose,
}: SsoProviderFormProps) {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.ssoProviders.form');
  const { addProvider, editProvider, loading } = useSsoProvidersStore();

  // Form state
  const [formData, setFormData] = useState<CreateSsoProviderData>({
    name: '',
    protocol: 'CAS',
    settings: getDefaultSettings('CAS'),
    enabled: true,
    display_order: 0,
  });

  // UI state
  const [activeTab, setActiveTab] = useState('basic');
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonValue, setRawJsonValue] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Initialize form data when provider changes
  useEffect(() => {
    if (mode === 'edit' && provider) {
      setFormData({
        name: provider.name,
        protocol: provider.protocol,
        settings: provider.settings,
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        metadata_url: provider.metadata_url,
        enabled: provider.enabled,
        display_order: provider.display_order,
        button_text: provider.button_text,
      });
      setRawJsonValue(JSON.stringify(provider.settings, null, 2));
    } else if (mode === 'create') {
      const defaultSettings = getDefaultSettings(formData.protocol);
      setFormData({
        name: '',
        protocol: 'CAS',
        settings: defaultSettings,
        enabled: true,
        display_order: 0,
      });
      setRawJsonValue(JSON.stringify(defaultSettings, null, 2));
    }
  }, [mode, provider, formData.protocol]);

  // Handle protocol change
  const handleProtocolChange = (protocol: SsoProtocol) => {
    const defaultSettings = getDefaultSettings(protocol);
    setFormData((prev: CreateSsoProviderData) => ({
      ...prev,
      protocol,
      settings: defaultSettings,
    }));
    setRawJsonValue(JSON.stringify(defaultSettings, null, 2));
  };

  // Handle settings update from visual form
  const handleSettingsChange = (path: string, value: unknown) => {
    setFormData((prev: CreateSsoProviderData) => {
      const newSettings = {
        ...prev.settings,
      } as Record<string, unknown>;
      const keys = path.split('.');
      let current: Record<string, unknown> = newSettings;

      // Navigate to the parent object
      for (let i = 0; i < keys.length - 1; i++) {
        const next = current[keys[i]];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }

      // Set the final value
      const finalKey = keys[keys.length - 1];
      current[finalKey] = value;

      return {
        ...prev,
        settings: newSettings as SsoProviderSettings,
      };
    });

    // Update raw JSON
    setRawJsonValue(JSON.stringify(formData.settings, null, 2));
  };

  // Handle raw JSON change
  const handleRawJsonChange = (value: string) => {
    setRawJsonValue(value);

    try {
      const parsedSettings = JSON.parse(value);
      setFormData((prev: CreateSsoProviderData) => ({
        ...prev,
        settings: parsedSettings,
      }));
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
        onClose();
      }
    } catch {
      toast.error(t('messages.unexpectedError'));
    }
  };

  // Handle close with confirmation if form is dirty
  const handleClose = () => {
    onClose();
    setActiveTab('basic');
    setShowRawJson(false);
    setJsonError(null);
  };

  // Tab configuration
  const tabs = [
    {
      id: 'basic',
      label: t('tabs.basicInfo'),
      icon: Shield,
      color: 'blue',
    },
    {
      id: 'protocol',
      label: t('tabs.protocolConfig'),
      icon: Settings,
      color: 'purple',
    },
    {
      id: 'security',
      label: t('tabs.security'),
      icon: Lock,
      color: 'red',
    },
    {
      id: 'ui',
      label: t('tabs.uiSettings'),
      icon: Palette,
      color: 'green',
    },
  ];

  // Get tab color classes
  const getTabColorClasses = (color: string, isActive: boolean) => {
    const colorMap = {
      blue: {
        active: isDark
          ? 'bg-blue-500/20 text-blue-400 border-blue-500'
          : 'bg-blue-50 text-blue-700 border-blue-500',
        inactive: isDark
          ? 'text-stone-400 hover:text-blue-400'
          : 'text-stone-600 hover:text-blue-600',
      },
      purple: {
        active: isDark
          ? 'bg-purple-500/20 text-purple-400 border-purple-500'
          : 'bg-purple-50 text-purple-700 border-purple-500',
        inactive: isDark
          ? 'text-stone-400 hover:text-purple-400'
          : 'text-stone-600 hover:text-purple-600',
      },
      red: {
        active: isDark
          ? 'bg-red-500/20 text-red-400 border-red-500'
          : 'bg-red-50 text-red-700 border-red-500',
        inactive: isDark
          ? 'text-stone-400 hover:text-red-400'
          : 'text-stone-600 hover:text-red-600',
      },
      green: {
        active: isDark
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500'
          : 'bg-emerald-50 text-emerald-700 border-emerald-500',
        inactive: isDark
          ? 'text-stone-400 hover:text-emerald-400'
          : 'text-stone-600 hover:text-emerald-600',
      },
    };

    return (
      colorMap[color as keyof typeof colorMap]?.[
        isActive ? 'active' : 'inactive'
      ] || ''
    );
  };

  if (!isOpen) return null;

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
        {/* Header */}
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

        {/* Content */}
        <div className="flex h-[calc(90vh-140px)]">
          {/* Sidebar Navigation */}
          <div
            className={cn(
              'w-64 border-r p-6',
              isDark
                ? 'border-stone-700/50 bg-stone-800/50'
                : 'border-stone-200/50 bg-stone-50/50'
            )}
          >
            <div className="space-y-2">
              {tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-4 py-3 font-serif text-sm font-medium transition-all duration-200',
                      isActive
                        ? getTabColorClasses(tab.color, true)
                        : cn(
                            'border-transparent',
                            getTabColorClasses(tab.color, false),
                            isDark
                              ? 'hover:bg-stone-700/50'
                              : 'hover:bg-stone-100/50'
                          )
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Raw JSON Toggle */}
            <div
              className={cn(
                'mt-6 border-t pt-6',
                isDark ? 'border-stone-700/50' : 'border-stone-200/50'
              )}
            >
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-4 py-3 font-serif text-sm font-medium transition-all duration-200',
                  showRawJson
                    ? isDark
                      ? 'border-amber-500/50 bg-amber-900/20 text-amber-400'
                      : 'border-amber-500/50 bg-amber-50 text-amber-700'
                    : cn(
                        'border-transparent',
                        isDark
                          ? 'text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                          : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700'
                      )
                )}
              >
                <Code className="h-4 w-4" />
                {showRawJson ? t('hideRawJson') : t('showRawJson')}
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6">
              {/* Raw JSON Editor */}
              {showRawJson && (
                <div className="mb-6">
                  <label
                    className={cn(
                      'mb-3 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('rawJsonConfig')}
                  </label>
                  <div className="relative">
                    <textarea
                      value={rawJsonValue}
                      onChange={e => handleRawJsonChange(e.target.value)}
                      className={cn(
                        'w-full rounded-lg border p-4 font-mono text-sm transition-colors',
                        'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                        jsonError
                          ? isDark
                            ? 'border-red-500 bg-red-900/20 text-red-200 focus:ring-red-500/30'
                            : 'border-red-500 bg-red-50 text-red-900 focus:ring-red-500/30'
                          : isDark
                            ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                            : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                      )}
                      rows={20}
                      placeholder={t('rawJsonConfig')}
                    />
                    {jsonError && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-red-500">
                        <AlertCircle className="h-4 w-4" />
                        {jsonError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab Content */}
              {!showRawJson && (
                <div className="space-y-6">
                  {/* Basic Info Tab */}
                  {activeTab === 'basic' && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {/* Provider Name */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.providerName')}
                          </label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={e =>
                              setFormData({ ...formData, name: e.target.value })
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.providerNamePlaceholder')}
                            required
                          />
                        </div>

                        {/* Protocol */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.protocol')}
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {(
                              ['CAS', 'SAML', 'OAuth2', 'OIDC'] as SsoProtocol[]
                            ).map(protocol => {
                              const Icon = protocolIcons[protocol];
                              const isSelected = formData.protocol === protocol;

                              return (
                                <button
                                  key={protocol}
                                  type="button"
                                  onClick={() => handleProtocolChange(protocol)}
                                  className={cn(
                                    'flex items-center gap-2 rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                                    isSelected
                                      ? isDark
                                        ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400'
                                        : 'border-emerald-500/50 bg-emerald-50 text-emerald-700'
                                      : isDark
                                        ? 'border-stone-600 text-stone-400 hover:border-stone-500 hover:bg-stone-700/50'
                                        : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50/80'
                                  )}
                                >
                                  <Icon className="h-4 w-4" />
                                  {protocol}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Display Order */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.displayOrder')}
                          </label>
                          <input
                            type="number"
                            value={formData.display_order}
                            onChange={e =>
                              setFormData({
                                ...formData,
                                display_order: parseInt(e.target.value) || 0,
                              })
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            min="0"
                          />
                        </div>

                        {/* Button Text */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.buttonText')}
                          </label>
                          <input
                            type="text"
                            value={formData.button_text || ''}
                            onChange={e =>
                              setFormData({
                                ...formData,
                                button_text: e.target.value || null,
                              })
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.buttonTextPlaceholder')}
                          />
                        </div>

                        {/* Email Domain */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.emailDomain')}
                          </label>
                          <input
                            type="text"
                            value={
                              typeof formData.settings.email_domain === 'string'
                                ? formData.settings.email_domain
                                : ''
                            }
                            onChange={e =>
                              handleSettingsChange(
                                'email_domain',
                                e.target.value
                              )
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.emailDomainPlaceholder')}
                          />
                        </div>
                      </div>

                      {/* Enable Provider */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              enabled: !formData.enabled,
                            })
                          }
                          className={cn(
                            'relative h-6 w-11 rounded-full border-2 transition-colors',
                            formData.enabled
                              ? isDark
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-emerald-600 bg-emerald-600'
                              : isDark
                                ? 'border-stone-600 bg-stone-700'
                                : 'border-stone-300 bg-stone-200'
                          )}
                        >
                          <div
                            className={cn(
                              'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                              formData.enabled
                                ? 'translate-x-5'
                                : 'translate-x-0.5'
                            )}
                          />
                        </button>
                        <label
                          className={cn(
                            'font-serif text-sm font-medium',
                            isDark ? 'text-stone-300' : 'text-stone-700'
                          )}
                        >
                          {t('fields.enableProvider')}
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Protocol Config Tab */}
                  {activeTab === 'protocol' && (
                    <div className="space-y-6">
                      {/* Base URL */}
                      <div>
                        <label
                          className={cn(
                            'mb-2 block font-serif text-sm font-medium',
                            isDark ? 'text-stone-300' : 'text-stone-700'
                          )}
                        >
                          {t('fields.baseUrl')}
                        </label>
                        <input
                          type="url"
                          value={formData.settings.protocol_config.base_url}
                          onChange={e =>
                            handleSettingsChange(
                              'protocol_config.base_url',
                              e.target.value
                            )
                          }
                          className={cn(
                            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                            isDark
                              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                          )}
                          placeholder={t('fields.baseUrlPlaceholder')}
                          required
                        />
                      </div>

                      {/* Endpoints */}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.loginEndpoint')}
                          </label>
                          <input
                            type="text"
                            value={
                              formData.settings.protocol_config.endpoints.login
                            }
                            onChange={e =>
                              handleSettingsChange(
                                'protocol_config.endpoints.login',
                                e.target.value
                              )
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.loginEndpointPlaceholder')}
                          />
                        </div>

                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.logoutEndpoint')}
                          </label>
                          <input
                            type="text"
                            value={
                              formData.settings.protocol_config.endpoints.logout
                            }
                            onChange={e =>
                              handleSettingsChange(
                                'protocol_config.endpoints.logout',
                                e.target.value
                              )
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.logoutEndpointPlaceholder')}
                          />
                        </div>
                      </div>

                      {/* Attribute Mapping */}
                      <div>
                        <h3
                          className={cn(
                            'mb-4 font-serif text-lg font-semibold',
                            isDark ? 'text-stone-200' : 'text-stone-800'
                          )}
                        >
                          {t('fields.attributeMapping')}
                        </h3>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label
                              className={cn(
                                'mb-2 block font-serif text-sm font-medium',
                                isDark ? 'text-stone-300' : 'text-stone-700'
                              )}
                            >
                              {t('fields.employeeId')}
                            </label>
                            <input
                              type="text"
                              value={
                                formData.settings.protocol_config
                                  .attributes_mapping.employee_id
                              }
                              onChange={e =>
                                handleSettingsChange(
                                  'protocol_config.attributes_mapping.employee_id',
                                  e.target.value
                                )
                              }
                              className={cn(
                                'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                                'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                                isDark
                                  ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                  : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                              )}
                              placeholder={t('fields.employeeIdPlaceholder')}
                            />
                          </div>

                          <div>
                            <label
                              className={cn(
                                'mb-2 block font-serif text-sm font-medium',
                                isDark ? 'text-stone-300' : 'text-stone-700'
                              )}
                            >
                              {t('fields.username')}
                            </label>
                            <input
                              type="text"
                              value={
                                formData.settings.protocol_config
                                  .attributes_mapping.username
                              }
                              onChange={e =>
                                handleSettingsChange(
                                  'protocol_config.attributes_mapping.username',
                                  e.target.value
                                )
                              }
                              className={cn(
                                'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                                'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                                isDark
                                  ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                  : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                              )}
                              placeholder={t('fields.usernamePlaceholder')}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Security Tab */}
                  {activeTab === 'security' && (
                    <div className="space-y-6">
                      {/* Security Toggles */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleSettingsChange(
                                'security.require_https',
                                !formData.settings.security.require_https
                              )
                            }
                            className={cn(
                              'relative h-6 w-11 rounded-full border-2 transition-colors',
                              formData.settings.security.require_https
                                ? isDark
                                  ? 'border-emerald-500 bg-emerald-500'
                                  : 'border-emerald-600 bg-emerald-600'
                                : isDark
                                  ? 'border-stone-600 bg-stone-700'
                                  : 'border-stone-300 bg-stone-200'
                            )}
                          >
                            <div
                              className={cn(
                                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                formData.settings.security.require_https
                                  ? 'translate-x-5'
                                  : 'translate-x-0.5'
                              )}
                            />
                          </button>
                          <label
                            className={cn(
                              'font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.requireHttps')}
                          </label>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleSettingsChange(
                                'security.validate_certificates',
                                !formData.settings.security
                                  .validate_certificates
                              )
                            }
                            className={cn(
                              'relative h-6 w-11 rounded-full border-2 transition-colors',
                              formData.settings.security.validate_certificates
                                ? isDark
                                  ? 'border-emerald-500 bg-emerald-500'
                                  : 'border-emerald-600 bg-emerald-600'
                                : isDark
                                  ? 'border-stone-600 bg-stone-700'
                                  : 'border-stone-300 bg-stone-200'
                            )}
                          >
                            <div
                              className={cn(
                                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                formData.settings.security.validate_certificates
                                  ? 'translate-x-5'
                                  : 'translate-x-0.5'
                              )}
                            />
                          </button>
                          <label
                            className={cn(
                              'font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.validateCertificates')}
                          </label>
                        </div>
                      </div>

                      {/* Allowed Redirect Hosts */}
                      <div>
                        <label
                          className={cn(
                            'mb-2 block font-serif text-sm font-medium',
                            isDark ? 'text-stone-300' : 'text-stone-700'
                          )}
                        >
                          {t('fields.allowedRedirectHosts')}
                        </label>
                        <textarea
                          value={
                            formData.settings.security.allowed_redirect_hosts?.join(
                              '\n'
                            ) || ''
                          }
                          onChange={e =>
                            handleSettingsChange(
                              'security.allowed_redirect_hosts',
                              e.target.value.split('\n').filter(Boolean)
                            )
                          }
                          className={cn(
                            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                            isDark
                              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                          )}
                          placeholder={t(
                            'fields.allowedRedirectHostsPlaceholder'
                          )}
                          rows={4}
                        />
                        <p
                          className={cn(
                            'mt-2 font-serif text-xs',
                            isDark ? 'text-stone-400' : 'text-stone-600'
                          )}
                        >
                          {t('fields.allowedRedirectHostsHint')}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* UI Settings Tab */}
                  {activeTab === 'ui' && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {/* Icon */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.icon')}
                          </label>
                          <input
                            type="text"
                            value={formData.settings.ui.icon || ''}
                            onChange={e =>
                              handleSettingsChange('ui.icon', e.target.value)
                            }
                            className={cn(
                              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                              isDark
                                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                            )}
                            placeholder={t('fields.iconPlaceholder')}
                          />
                        </div>

                        {/* Theme */}
                        <div>
                          <label
                            className={cn(
                              'mb-2 block font-serif text-sm font-medium',
                              isDark ? 'text-stone-300' : 'text-stone-700'
                            )}
                          >
                            {t('fields.theme')}
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['primary', 'secondary', 'default', 'outline'].map(
                              theme => (
                                <button
                                  key={theme}
                                  type="button"
                                  onClick={() =>
                                    handleSettingsChange('ui.theme', theme)
                                  }
                                  className={cn(
                                    'rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                                    formData.settings.ui.theme === theme
                                      ? isDark
                                        ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400'
                                        : 'border-emerald-500/50 bg-emerald-50 text-emerald-700'
                                      : isDark
                                        ? 'border-stone-600 text-stone-400 hover:border-stone-500 hover:bg-stone-700/50'
                                        : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50/80'
                                  )}
                                >
                                  {t(`themes.${theme}`)}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label
                          className={cn(
                            'mb-2 block font-serif text-sm font-medium',
                            isDark ? 'text-stone-300' : 'text-stone-700'
                          )}
                        >
                          {t('fields.description')}
                        </label>
                        <textarea
                          value={formData.settings.ui.description || ''}
                          onChange={e =>
                            handleSettingsChange(
                              'ui.description',
                              e.target.value
                            )
                          }
                          className={cn(
                            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                            isDark
                              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                          )}
                          placeholder={t('fields.descriptionPlaceholder')}
                          rows={3}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Footer */}
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
                  : isDark
                    ? 'bg-emerald-600 hover:bg-emerald-700'
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
