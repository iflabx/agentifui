'use client';

import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { Switch } from '@components/ui/switch';
import { useTheme } from '@lib/hooks/use-theme';
import { Provider } from '@lib/types/database';
import { cn } from '@lib/utils';
import { Save } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';

import { getAuthTypeLabel, getProviderTypeLabel } from './provider-labels';

const PROVIDER_TYPES = [
  'llm',
  'platform',
  'embedding',
  'tts',
  'stt',
  'vision',
  'multimodal',
] as const;

const AUTH_TYPES = [
  'api_key',
  'bearer_token',
  'oauth2',
  'basic_auth',
  'none',
] as const;

function buildSelectOptions(
  defaultValues: readonly string[],
  currentValue: string
) {
  if (!currentValue || defaultValues.includes(currentValue)) {
    return [...defaultValues];
  }

  return [...defaultValues, currentValue];
}

interface ProviderFormData {
  name: string;
  type: string;
  base_url: string;
  auth_type: string;
  is_active: boolean;
  is_default: boolean;
}

interface ProviderFormProps {
  provider?: Provider | null;
  isCreating?: boolean;
  onSave: (data: ProviderFormData) => void;
  onCancel: () => void;
  loading?: boolean;
  errors?: Partial<ProviderFormData>;
}

export function ProviderForm({
  provider,
  isCreating = false,
  onSave,
  onCancel,
  loading = false,
  errors = {},
}: ProviderFormProps) {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.apiConfig.providerManagement.modal');

  const [formData, setFormData] = React.useState<ProviderFormData>(() => ({
    name: provider?.name || '',
    type: provider?.type || 'llm',
    base_url: provider?.base_url || '',
    auth_type: provider?.auth_type || 'api_key',
    is_active: provider?.is_active ?? true,
    is_default: provider?.is_default ?? false,
  }));

  const updateField = (
    field: keyof ProviderFormData,
    value: string | boolean
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const providerTypeOptions = React.useMemo(
    () => buildSelectOptions(PROVIDER_TYPES, formData.type),
    [formData.type]
  );

  const authTypeOptions = React.useMemo(
    () => buildSelectOptions(AUTH_TYPES, formData.auth_type),
    [formData.auth_type]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3
          className={cn(
            'font-serif text-lg font-semibold',
            isDark ? 'text-stone-100' : 'text-stone-900'
          )}
        >
          {isCreating ? t('addNewProvider') : t('editProvider')}
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="font-serif">
              {t('form.name.label')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={e => updateField('name', e.target.value)}
              placeholder={t('form.name.placeholder')}
              className={cn(
                'font-serif',
                errors.name && 'border-red-500 focus:border-red-500'
              )}
              disabled={loading}
            />
            {errors.name && (
              <p className="font-serif text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" className="font-serif">
              {t('form.type.label')} <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.type}
              onValueChange={value => updateField('type', value)}
              disabled={loading}
            >
              <SelectTrigger
                className={cn(
                  'font-serif',
                  errors.type && 'border-red-500 focus:border-red-500'
                )}
              >
                <SelectValue placeholder={t('form.type.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {providerTypeOptions.map(type => (
                  <SelectItem key={type} value={type}>
                    {getProviderTypeLabel(t, type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.type && (
              <p className="font-serif text-sm text-red-600">{errors.type}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="base_url" className="font-serif">
            {t('form.baseUrl.label')} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="base_url"
            value={formData.base_url}
            onChange={e => updateField('base_url', e.target.value)}
            placeholder={t('form.baseUrl.placeholder')}
            className={cn(
              'font-serif',
              errors.base_url && 'border-red-500 focus:border-red-500'
            )}
            disabled={loading}
          />
          {errors.base_url && (
            <p className="font-serif text-sm text-red-600">{errors.base_url}</p>
          )}
        </div>

        <div className="grid grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="auth_type" className="font-serif">
              {t('form.authType.label')} <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.auth_type}
              onValueChange={value => updateField('auth_type', value)}
              disabled={loading}
            >
              <SelectTrigger
                className={cn(
                  'font-serif',
                  errors.auth_type && 'border-red-500 focus:border-red-500'
                )}
              >
                <SelectValue placeholder={t('form.authType.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {authTypeOptions.map(auth => (
                  <SelectItem key={auth} value={auth}>
                    {getAuthTypeLabel(t, auth)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.auth_type && (
              <p className="font-serif text-sm text-red-600">
                {errors.auth_type}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div
            className={cn(
              'flex items-center justify-between rounded-xl border-2 p-4 transition-all duration-200',
              isDark
                ? 'border-stone-600 bg-stone-800/30'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div className="space-y-1">
              <Label className="font-serif text-sm font-semibold">
                {t('form.isActive.label')}
              </Label>
              <p
                className={cn(
                  'font-serif text-xs',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {formData.is_active
                  ? t('status.enabled')
                  : t('status.disabled')}
              </p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={checked => updateField('is_active', checked)}
              disabled={loading}
            />
          </div>

          <div
            className={cn(
              'flex items-center justify-between rounded-xl border-2 p-4 transition-all duration-200',
              isDark
                ? 'border-stone-600 bg-stone-800/30'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div className="space-y-1">
              <Label className="font-serif text-sm font-semibold">
                {t('form.isDefault.label')}
              </Label>
              <p
                className={cn(
                  'font-serif text-xs',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {formData.is_default
                  ? t('form.isDefault.setAsDefault')
                  : t('form.isDefault.notDefault')}
              </p>
            </div>
            <Switch
              checked={formData.is_default}
              onCheckedChange={checked => updateField('is_default', checked)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-stone-200 pt-6 dark:border-stone-700">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className={cn(
              'font-serif font-medium transition-all duration-200',
              isDark
                ? 'border-stone-600 text-stone-300 hover:bg-stone-700 hover:text-stone-100'
                : 'border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-900'
            )}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className={cn(
              'gap-2 font-serif font-medium shadow-sm transition-all duration-200 hover:shadow-md',
              isDark
                ? 'border-0 bg-stone-600 text-white hover:bg-stone-500'
                : 'border-0 bg-stone-800 text-white hover:bg-stone-700'
            )}
          >
            <Save className="h-4 w-4" />
            {loading ? t('buttons.saving') : t('buttons.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
