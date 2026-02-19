'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog';
import type { EnhancedUser } from '@lib/db/users';
import { cn } from '@lib/utils';
import { Loader2, Lock } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';

interface UserEditModalProps {
  isOpen: boolean;
  user: EnhancedUser | null;
  isLoading: boolean;
  isSubmitting: boolean;
  canEditRoleStatus: boolean;
  onClose: () => void;
  onSave: (updates: Record<string, unknown>) => Promise<boolean>;
}

type UserEditFormState = {
  full_name: string;
  username: string;
  email: string;
  phone: string;
  avatar_url: string;
  role: 'admin' | 'manager' | 'user';
  status: 'active' | 'suspended' | 'pending';
};

const LOCAL_PROFILE_AUTH_SOURCES = new Set([
  '',
  'password',
  'better-auth',
  'credentials',
  'native',
]);

const FIELD_ORDER = [
  'full_name',
  'username',
  'email',
  'phone',
  'avatar_url',
] as const;

function normalizeAuthSource(source: string | null | undefined): string {
  return (source || 'native').trim().toLowerCase() || 'native';
}

function buildInitialState(user: EnhancedUser | null): UserEditFormState {
  return {
    full_name: user?.full_name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
    avatar_url: user?.avatar_url || '',
    role: user?.role || 'user',
    status: user?.status || 'active',
  };
}

function toNullableTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function formatReadonlyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '-';
  }
}

function buildEditableFieldSet(user: EnhancedUser | null): Set<string> {
  if (!user) {
    return new Set();
  }
  if (Array.isArray(user.editable_fields) && user.editable_fields.length > 0) {
    return new Set(user.editable_fields);
  }

  const normalizedSource = normalizeAuthSource(user.auth_source);
  if (LOCAL_PROFILE_AUTH_SOURCES.has(normalizedSource)) {
    return new Set(['full_name', 'username', 'email', 'phone', 'avatar_url']);
  }
  return new Set(['username', 'avatar_url']);
}

export function UserEditModal({
  isOpen,
  user,
  isLoading,
  isSubmitting,
  canEditRoleStatus,
  onClose,
  onSave,
}: UserEditModalProps) {
  const t = useTranslations('pages.admin.users.editModal');
  const [baselineState, setBaselineState] = React.useState<UserEditFormState>(
    buildInitialState(user)
  );
  const [formState, setFormState] = React.useState<UserEditFormState>(
    buildInitialState(user)
  );
  const editableFields = React.useMemo(
    () => buildEditableFieldSet(user),
    [user]
  );

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextState = buildInitialState(user);
    setBaselineState(nextState);
    setFormState(nextState);
  }, [isOpen, user]);

  const isIdpManaged = Boolean(
    user?.is_idp_managed ??
      (user
        ? !LOCAL_PROFILE_AUTH_SOURCES.has(normalizeAuthSource(user.auth_source))
        : false)
  );

  const isFieldEditable = (field: string) => editableFields.has(field);

  const handleFieldChange = (
    field: keyof UserEditFormState,
    value: string | UserEditFormState['role'] | UserEditFormState['status']
  ) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const updates: Record<string, unknown> = {};
    for (const field of FIELD_ORDER) {
      if (!isFieldEditable(field)) {
        continue;
      }

      if (formState[field] !== baselineState[field]) {
        updates[field] = toNullableTrimmed(formState[field]);
      }
    }

    if (canEditRoleStatus && formState.role !== baselineState.role) {
      updates.role = formState.role;
    }
    if (canEditRoleStatus && formState.status !== baselineState.status) {
      updates.status = formState.status;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    const ok = await onSave(updates);
    if (ok) {
      onClose();
    }
  };

  const readOnlyRows = [
    {
      key: 'auth_source',
      label: t('readonly.authSource'),
      value: user?.auth_source,
    },
    {
      key: 'sso_provider_id',
      label: t('readonly.ssoProviderId'),
      value: user?.sso_provider_id,
    },
    {
      key: 'employee_number',
      label: t('readonly.employeeNumber'),
      value: user?.external_profile?.employee_number || user?.employee_number,
    },
    {
      key: 'department_name',
      label: t('readonly.departmentName'),
      value: user?.external_profile?.department_name,
    },
    {
      key: 'job_title',
      label: t('readonly.jobTitle'),
      value: user?.external_profile?.job_title,
    },
    {
      key: 'manager_name',
      label: t('readonly.managerName'),
      value: user?.external_profile?.manager_name,
    },
    {
      key: 'synced_at',
      label: t('readonly.syncedAt'),
      value: user?.external_profile?.synced_at,
    },
    {
      key: 'last_seen_at',
      label: t('readonly.lastSeenAt'),
      value: user?.external_profile?.last_seen_at,
    },
  ];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !isSubmitting && !open && onClose()}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('title', {
              name: user?.full_name || user?.email || user?.id || '-',
            })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-stone-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('loading')}
          </div>
        ) : !user ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
            {t('noData')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">
                  {t('sections.profile')}
                </h3>
                {isIdpManaged ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                    <Lock className="h-3.5 w-3.5" />
                    {t('badges.idpManaged')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {t('badges.localAccount')}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.fullName')}
                  </span>
                  <input
                    value={formState.full_name}
                    disabled={!isFieldEditable('full_name') || isSubmitting}
                    onChange={event =>
                      handleFieldChange('full_name', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !isFieldEditable('full_name') &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  />
                  {!isFieldEditable('full_name') && (
                    <p className="text-xs text-stone-500">
                      {t('readonly.idpHint')}
                    </p>
                  )}
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.username')}
                  </span>
                  <input
                    value={formState.username}
                    disabled={!isFieldEditable('username') || isSubmitting}
                    onChange={event =>
                      handleFieldChange('username', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !isFieldEditable('username') &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.email')}
                  </span>
                  <input
                    value={formState.email}
                    disabled={!isFieldEditable('email') || isSubmitting}
                    onChange={event =>
                      handleFieldChange('email', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !isFieldEditable('email') &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  />
                  {!isFieldEditable('email') && (
                    <p className="text-xs text-stone-500">
                      {t('readonly.idpHint')}
                    </p>
                  )}
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.phone')}
                  </span>
                  <input
                    value={formState.phone}
                    disabled={!isFieldEditable('phone') || isSubmitting}
                    onChange={event =>
                      handleFieldChange('phone', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !isFieldEditable('phone') &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  />
                </label>

                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.avatarUrl')}
                  </span>
                  <input
                    value={formState.avatar_url}
                    disabled={!isFieldEditable('avatar_url') || isSubmitting}
                    onChange={event =>
                      handleFieldChange('avatar_url', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !isFieldEditable('avatar_url') &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.role')}
                  </span>
                  <select
                    value={formState.role}
                    disabled={!canEditRoleStatus || isSubmitting}
                    onChange={event =>
                      handleFieldChange(
                        'role',
                        event.target.value as UserEditFormState['role']
                      )
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !canEditRoleStatus &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  >
                    <option value="admin">{t('options.role.admin')}</option>
                    <option value="manager">{t('options.role.manager')}</option>
                    <option value="user">{t('options.role.user')}</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {t('fields.status')}
                  </span>
                  <select
                    value={formState.status}
                    disabled={!canEditRoleStatus || isSubmitting}
                    onChange={event =>
                      handleFieldChange(
                        'status',
                        event.target.value as UserEditFormState['status']
                      )
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm',
                      !canEditRoleStatus &&
                        'cursor-not-allowed bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                    )}
                  >
                    <option value="active">{t('options.status.active')}</option>
                    <option value="suspended">
                      {t('options.status.suspended')}
                    </option>
                    <option value="pending">
                      {t('options.status.pending')}
                    </option>
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold text-stone-900 dark:text-stone-100">
                {t('sections.readonly')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {readOnlyRows.map(row => (
                  <div
                    key={row.key}
                    className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
                  >
                    <p className="text-xs text-stone-500">{row.label}</p>
                    <p className="mt-1 text-sm break-all text-stone-800 dark:text-stone-200">
                      {formatReadonlyValue(row.value)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <DialogFooter className="gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoading || !user}
                className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('actions.saving')}
                  </>
                ) : (
                  t('actions.save')
                )}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
