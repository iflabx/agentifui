'use client';

import { Button } from '@components/ui/button';
import { CloseButton } from '@components/ui/close-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog';
import { useTheme } from '@lib/hooks/use-theme';
import {
  createProvider,
  deleteProvider,
  getAllProviders,
  updateProvider,
} from '@lib/services/client/providers-api';
import { Provider } from '@lib/types/database';
import { cn } from '@lib/utils';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ProviderCard } from './provider-card';
import { ProviderForm } from './provider-form';

interface ProviderFormData {
  name: string;
  type: string;
  base_url: string;
  auth_type: string;
  is_active: boolean;
  is_default: boolean;
}

interface ProviderManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProviderChange?: () => void;
}

export function ProviderManagementModal({
  open,
  onOpenChange,
  onProviderChange,
}: ProviderManagementModalProps) {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.apiConfig.providerManagement.modal');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<ProviderFormData>>({});

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAllProviders();
      if (result.success) {
        setProviders(result.data);
      } else {
        toast.error(t('messages.loadFailed'));
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
      toast.error(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      loadProviders();
    }
  }, [open, loadProviders]);

  const validateForm = (data: ProviderFormData): boolean => {
    const newErrors: Partial<ProviderFormData> = {};

    if (!data.name.trim()) {
      newErrors.name = t('form.name.required');
    }

    if (!data.type) {
      newErrors.type = t('form.type.required');
    }

    if (!data.base_url.trim()) {
      newErrors.base_url = t('form.baseUrl.required');
    } else {
      try {
        new URL(data.base_url);
      } catch {
        newErrors.base_url = t('form.baseUrl.invalid');
      }
    }

    if (!data.auth_type) {
      newErrors.auth_type = t('form.authType.required');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateProvider = () => {
    setEditingProvider(null);
    setIsCreating(true);
    setErrors({});
  };

  const handleEditProvider = (provider: Provider) => {
    setEditingProvider(provider);
    setIsCreating(false);
    setErrors({});
  };

  const handleDeleteProvider = async (provider: Provider) => {
    const confirmMessage = t('deleteConfirm', { name: provider.name });
    if (window.confirm(confirmMessage)) {
      try {
        const result = await deleteProvider(provider.id);
        if (result.success) {
          toast.success(t('messages.deleteSuccess'));
          await loadProviders();
          onProviderChange?.();
        } else {
          toast.error(t('messages.deleteFailed'));
        }
      } catch (error) {
        console.error('Failed to delete provider:', error);
        toast.error(t('messages.deleteFailed'));
      }
    }
  };

  const handleFormSave = async (data: ProviderFormData) => {
    if (!validateForm(data)) {
      return;
    }

    setFormLoading(true);
    try {
      if (isCreating) {
        const result = await createProvider(data);
        if (result.success) {
          toast.success(t('messages.createSuccess'));
          await loadProviders();
          resetForm();
          onProviderChange?.();
        } else {
          toast.error(t('messages.createFailed'));
        }
      } else if (editingProvider) {
        const result = await updateProvider(editingProvider.id, data);
        if (result.success) {
          toast.success(t('messages.updateSuccess'));
          await loadProviders();
          resetForm();
          onProviderChange?.();
        } else {
          toast.error(t('messages.updateFailed'));
        }
      }
    } catch (error) {
      console.error('Failed to save provider:', error);
      toast.error(t('messages.saveFailed'));
    } finally {
      setFormLoading(false);
    }
  };

  const handleFormCancel = () => {
    resetForm();
  };

  const resetForm = () => {
    setEditingProvider(null);
    setIsCreating(false);
    setErrors({});
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className={cn(
            'max-h-[90vh] max-w-6xl overflow-hidden p-0 font-serif [&>button]:hidden',
            isDark
              ? 'border-stone-700 bg-stone-900'
              : 'border-stone-200 bg-white'
          )}
        >
          <DialogHeader
            className={cn(
              'flex-shrink-0 border-b px-8 py-6',
              isDark ? 'border-stone-700' : 'border-stone-200'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <DialogTitle
                  className={cn(
                    'font-serif text-2xl font-semibold',
                    isDark ? 'text-stone-100' : 'text-stone-900'
                  )}
                >
                  {t('title')}
                </DialogTitle>
              </div>

              <div className="flex items-center gap-6">
                <Button
                  onClick={handleCreateProvider}
                  disabled={loading || isCreating || editingProvider !== null}
                  className={cn(
                    'gap-2 rounded-lg font-serif font-medium shadow-sm transition-all duration-200 hover:shadow-md',
                    isDark
                      ? 'border-0 bg-stone-600 text-white hover:bg-stone-500'
                      : 'border-0 bg-stone-800 text-white hover:bg-stone-700'
                  )}
                  size="default"
                >
                  <Plus className="h-4 w-4" />
                  {t('addProvider')}
                </Button>

                <CloseButton onClick={handleClose} size="md" variant="subtle" />
              </div>
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                'flex-1 border-r',
                isDark ? 'border-stone-700' : 'border-stone-200'
              )}
            >
              <div
                className="h-full overflow-y-auto p-6"
                style={{ maxHeight: 'calc(90vh - 140px)' }}
              >
                {loading && providers.length === 0 ? (
                  <div
                    className={cn(
                      'py-16 text-center',
                      isDark ? 'text-stone-400' : 'text-stone-600'
                    )}
                  >
                    <div className="font-serif text-lg">{t('loading')}</div>
                  </div>
                ) : providers.length === 0 ? (
                  <div
                    className={cn(
                      'py-16 text-center',
                      isDark ? 'text-stone-400' : 'text-stone-600'
                    )}
                  >
                    <div className="font-serif text-lg">{t('noProviders')}</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {providers.map(provider => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        onEdit={handleEditProvider}
                        onDelete={handleDeleteProvider}
                        isEditing={editingProvider?.id === provider.id}
                        disabled={loading || formLoading}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {(isCreating || editingProvider) && (
              <div className="w-[480px] flex-shrink-0 border-l border-stone-200 dark:border-stone-700">
                <div
                  className="h-full overflow-y-auto p-6"
                  style={{ maxHeight: 'calc(90vh - 140px)' }}
                >
                  <ProviderForm
                    provider={editingProvider}
                    isCreating={isCreating}
                    onSave={handleFormSave}
                    onCancel={handleFormCancel}
                    loading={formLoading}
                    errors={errors}
                  />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
