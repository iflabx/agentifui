'use client';

import type { Group } from '@lib/db/group-permissions';
import { useTheme } from '@lib/hooks/use-theme';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import { cn } from '@lib/utils';
import { Building2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface EditGroupModalProps {
  group: Group;
  isOpen: boolean;
  onClose: () => void;
}

export function EditGroupModal({
  group,
  isOpen,
  onClose,
}: EditGroupModalProps) {
  const { isDark } = useTheme();
  const { updateGroup, loading } = useGroupManagementStore();
  const t = useTranslations('pages.admin.groups.editModal');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (group) {
      setFormData({
        name: group.name,
        description: group.description || '',
      });
    }
  }, [group]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = t('nameRequired');
    } else if (formData.name.trim().length < 2) {
      newErrors.name = t('nameTooShort');
    } else if (formData.name.trim().length > 50) {
      newErrors.name = t('nameTooLong');
    }

    if (formData.description && formData.description.length > 200) {
      newErrors.description = t('descriptionTooLong');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const hasChanges =
      formData.name.trim() !== group.name ||
      formData.description.trim() !== (group.description || '');

    if (!hasChanges) {
      toast.success(t('noChanges'));
      onClose();
      return;
    }

    const success = await updateGroup(group.id, {
      name: formData.name.trim(),
      description: formData.description.trim(),
    });

    if (success) {
      toast.success(t('updateSuccess', { name: formData.name }));
      setErrors({});
      onClose();
    }
  };

  const handleClose = () => {
    if (!loading.updating) {
      setErrors({});
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn(
          'absolute inset-0',
          isDark ? 'bg-black/50' : 'bg-black/30'
        )}
        onClick={handleClose}
      />

      <div
        className={cn(
          'relative w-full max-w-md rounded-xl border shadow-xl',
          isDark ? 'border-stone-700 bg-stone-800' : 'border-stone-200 bg-white'
        )}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                isDark ? 'bg-stone-700' : 'bg-stone-100'
              )}
            >
              <Building2
                className={cn(
                  'h-5 w-5',
                  isDark ? 'text-stone-300' : 'text-stone-600'
                )}
              />
            </div>
            <h2
              className={cn(
                'font-serif text-xl font-semibold',
                isDark ? 'text-stone-100' : 'text-stone-900'
              )}
            >
              {t('title')}
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading.updating}
            className={cn(
              'rounded-lg p-2 transition-colors',
              isDark
                ? 'text-stone-400 hover:bg-stone-700 hover:text-stone-300'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700',
              loading.updating && 'cursor-not-allowed opacity-50'
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6">
          <div className="space-y-4">
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  isDark ? 'text-stone-200' : 'text-stone-700'
                )}
              >
                {t('nameLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t('namePlaceholder')}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                  'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                  errors.name
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : isDark
                      ? 'border-stone-600 bg-stone-700 text-stone-200 placeholder-stone-400 focus:border-stone-500 focus:ring-stone-500 focus:ring-offset-stone-800'
                      : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500 focus:border-stone-400 focus:ring-stone-400 focus:ring-offset-white'
                )}
              />
              {errors.name && (
                <p className="mt-1 font-serif text-xs text-red-500">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  isDark ? 'text-stone-200' : 'text-stone-700'
                )}
              >
                {t('descriptionLabel')}
              </label>
              <textarea
                value={formData.description}
                onChange={e =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t('descriptionPlaceholder')}
                rows={3}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                  'resize-none focus:ring-2 focus:ring-offset-2 focus:outline-none',
                  errors.description
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : isDark
                      ? 'border-stone-600 bg-stone-700 text-stone-200 placeholder-stone-400 focus:border-stone-500 focus:ring-stone-500 focus:ring-offset-stone-800'
                      : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500 focus:border-stone-400 focus:ring-stone-400 focus:ring-offset-white'
                )}
              />
              {errors.description && (
                <p className="mt-1 font-serif text-xs text-red-500">
                  {errors.description}
                </p>
              )}
              <p
                className={cn(
                  'mt-1 font-serif text-xs',
                  isDark ? 'text-stone-400' : 'text-stone-500'
                )}
              >
                {formData.description.length}/200
              </p>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading.updating}
              className={cn(
                'flex-1 rounded-lg border px-4 py-2 font-serif text-sm transition-all duration-200',
                isDark
                  ? 'border-stone-600 text-stone-300 hover:bg-stone-700'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-50',
                loading.updating && 'cursor-not-allowed opacity-50'
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={loading.updating}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-serif text-sm transition-all duration-200',
                isDark
                  ? 'bg-stone-700 text-stone-100 hover:bg-stone-600'
                  : 'bg-stone-900 text-white hover:bg-stone-800',
                loading.updating && 'cursor-not-allowed opacity-50'
              )}
            >
              {loading.updating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('updating')}
                </>
              ) : (
                t('updateButton')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
