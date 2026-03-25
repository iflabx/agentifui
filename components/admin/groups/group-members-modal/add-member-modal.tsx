'use client';

import type { Group, SearchableUser } from '@lib/db/group-permissions';
import { useTheme } from '@lib/hooks/use-theme';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import { cn } from '@lib/utils';
import {
  CheckSquare,
  Loader2,
  Mail,
  Plus,
  Search,
  Square,
  User,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  createGroupUserPagination,
  getPaginationRange,
  selectAllVisibleUsers,
  toggleSelectedUserIds,
} from './helpers';

interface AddMemberModalProps {
  group: Group;
  isOpen: boolean;
  onClose: () => void;
}

export function AddMemberModal({
  group,
  isOpen,
  onClose,
}: AddMemberModalProps) {
  const { isDark } = useTheme();
  const { addMember, groupMembers } = useGroupManagementStore();
  const t = useTranslations('pages.admin.groups.addMembersModal');

  const [users, setUsers] = useState<SearchableUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState(createGroupUserPagination());

  const currentMembers = groupMembers[group.id] || [];
  const excludeUserIds = currentMembers.map(member => member.user_id);

  useEffect(() => {
    if (!isOpen) {
      setUsers([]);
      setSelectedUserIds([]);
      setSearchTerm('');
      setIsLoading(false);
      setIsAdding(false);
      setPagination(createGroupUserPagination());
    }
  }, [isOpen]);

  const loadUsers = async (page: number = 1, search: string = '') => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/users/for-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page,
          pageSize: pagination.pageSize,
          search: search.trim() || undefined,
          excludeUserIds,
        }),
      });

      if (!response.ok) {
        setUsers([]);
        return;
      }

      const data = await response.json();
      setUsers(data.users || []);
      setPagination({
        page: data.page || 1,
        pageSize: data.pageSize || 10,
        total: data.total || 0,
        totalPages: data.totalPages || 0,
      });
    } catch (error) {
      console.error('Load user list error:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsers(1, searchTerm);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = setTimeout(() => {
      loadUsers(1, searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [isOpen, searchTerm]);

  const handleBatchAddMembers = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    setIsAdding(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const userId of selectedUserIds) {
        const success = await addMember(group.id, userId);
        if (success) {
          successCount++;
        } else {
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(t('addSuccess', { count: successCount }));
        setSelectedUserIds([]);
        loadUsers(pagination.page, searchTerm);
      }

      if (errorCount > 0) {
        toast.error(t('addPartialSuccess', { errorCount }));
      }
    } finally {
      setIsAdding(false);
    }
  };

  const isAllSelected =
    users.length > 0 && selectedUserIds.length === users.length;
  const isPartiallySelected = selectedUserIds.length > 0 && !isAllSelected;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={cn(
          'relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border shadow-lg',
          isDark ? 'border-stone-700 bg-stone-800' : 'border-stone-200 bg-white'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between border-b p-6',
            isDark ? 'border-stone-700' : 'border-stone-200'
          )}
        >
          <div>
            <h3
              className={cn(
                'font-serif text-xl font-semibold',
                isDark ? 'text-stone-100' : 'text-stone-900'
              )}
            >
              {t('title')}
            </h3>
            <p
              className={cn(
                'font-serif text-sm',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            >
              {t('subtitle', { groupName: group.name })}
            </p>
          </div>

          <button
            onClick={onClose}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
              isDark
                ? 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search
                className={cn(
                  'absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2',
                  isDark ? 'text-stone-400' : 'text-stone-500'
                )}
              />
              <input
                type="text"
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                className={cn(
                  'w-full rounded-xl border py-3 pr-4 pl-10 font-serif transition-all duration-200',
                  'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                  isDark
                    ? 'border-stone-600 bg-stone-700/50 text-stone-200 placeholder-stone-400 focus:border-stone-500 focus:ring-stone-500 focus:ring-offset-stone-800'
                    : 'border-stone-300 bg-stone-50 text-stone-900 placeholder-stone-500 focus:border-stone-400 focus:ring-stone-500 focus:ring-offset-white'
                )}
              />
            </div>

            {selectedUserIds.length > 0 && (
              <button
                onClick={handleBatchAddMembers}
                disabled={isAdding}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-3 font-serif text-sm transition-all duration-200',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isDark
                    ? 'bg-stone-600 text-white hover:bg-stone-500 disabled:bg-stone-700'
                    : 'bg-stone-700 text-white hover:bg-stone-600 disabled:bg-stone-400'
                )}
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t('addSelected', { count: selectedUserIds.length })}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span
                  className={cn(
                    'font-serif text-sm',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                >
                  {t('loading')}
                </span>
              </div>
            </div>
          ) : users.length === 0 ? (
            <div
              className={cn(
                'flex items-center justify-center py-12',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            >
              <div className="text-center">
                <Users className="mx-auto mb-3 h-8 w-8" />
                <p className="font-serif text-sm">
                  {searchTerm ? t('noSearchResults') : t('noUsers')}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto p-2" style={{ maxHeight: '420px' }}>
              <div
                className={cn(
                  'bg-opacity-95 sticky top-0 mb-3 rounded-xl backdrop-blur-sm',
                  isDark ? 'bg-stone-800/80' : 'bg-white/80'
                )}
              >
                <div className="flex items-center px-6 py-3">
                  <div className="w-12">
                    <button
                      onClick={() =>
                        setSelectedUserIds(
                          selectAllVisibleUsers(users, !isAllSelected)
                        )
                      }
                      className={cn(
                        'flex items-center justify-center rounded-md p-1 transition-colors',
                        isDark
                          ? 'text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                          : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700'
                      )}
                    >
                      {isAllSelected ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : isPartiallySelected ? (
                        <Square className="h-4 w-4 border-2" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="flex-1">
                    <span
                      className={cn(
                        'font-serif text-sm font-semibold',
                        isDark ? 'text-stone-300' : 'text-stone-700'
                      )}
                    >
                      {t('tableHeaders.userInfo')}
                    </span>
                  </div>
                  <div className="w-24">
                    <span
                      className={cn(
                        'font-serif text-sm font-semibold',
                        isDark ? 'text-stone-300' : 'text-stone-700'
                      )}
                    >
                      {t('tableHeaders.role')}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                {users.map(user => {
                  const isSelected = selectedUserIds.includes(user.id);
                  return (
                    <div
                      key={user.id}
                      className={cn(
                        'mx-2 mb-2 flex items-center rounded-xl px-6 py-4 transition-all duration-200',
                        isSelected
                          ? isDark
                            ? 'bg-stone-700/50 ring-2 ring-stone-500'
                            : 'bg-stone-100 ring-2 ring-stone-400'
                          : isDark
                            ? 'bg-stone-800/30 hover:bg-stone-800/60'
                            : 'bg-stone-50/50 hover:bg-stone-100/80'
                      )}
                    >
                      <div className="w-12">
                        <button
                          onClick={() =>
                            setSelectedUserIds(prev =>
                              toggleSelectedUserIds(prev, user.id)
                            )
                          }
                          className={cn(
                            'flex items-center justify-center rounded-md p-1 transition-colors',
                            isDark
                              ? 'text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                              : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700'
                          )}
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      <div className="flex flex-1 items-center gap-3">
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-xl font-serif font-semibold',
                            isDark
                              ? 'bg-stone-600 text-stone-200'
                              : 'bg-stone-200 text-stone-700'
                          )}
                        >
                          {user.full_name?.[0] || user.username?.[0] || (
                            <User className="h-4 w-4" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4
                              className={cn(
                                'font-serif font-semibold',
                                isDark ? 'text-stone-200' : 'text-stone-800'
                              )}
                            >
                              {user.full_name ||
                                user.username ||
                                t('unknownUser')}
                            </h4>
                            {user.username && user.full_name && (
                              <span
                                className={cn(
                                  'font-serif text-sm',
                                  isDark ? 'text-stone-400' : 'text-stone-500'
                                )}
                              >
                                @{user.username}
                              </span>
                            )}
                          </div>

                          {user.email && (
                            <div className="mt-1 flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3" />
                              <span
                                className={cn(
                                  'font-serif',
                                  isDark ? 'text-stone-400' : 'text-stone-600'
                                )}
                              >
                                {user.email}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="w-24">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-lg border px-2 py-1 font-serif text-xs',
                            user.role === 'admin'
                              ? isDark
                                ? 'border-red-700 bg-red-900/30 text-red-300'
                                : 'border-red-200 bg-red-50 text-red-700'
                              : user.role === 'manager'
                                ? isDark
                                  ? 'border-amber-700 bg-amber-900/30 text-amber-300'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                                : isDark
                                  ? 'border-stone-600 bg-stone-700/50 text-stone-300'
                                  : 'border-stone-300 bg-stone-100 text-stone-700'
                          )}
                        >
                          {user.role === 'admin'
                            ? t('userRoles.admin')
                            : user.role === 'manager'
                              ? t('userRoles.manager')
                              : t('userRoles.user')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="p-4 pt-6">
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  'font-serif text-sm',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t(
                  'pagination.showing',
                  getPaginationRange(
                    pagination.page,
                    pagination.pageSize,
                    pagination.total
                  )
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadUsers(pagination.page - 1, searchTerm)}
                  disabled={pagination.page <= 1 || isLoading}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
                    pagination.page <= 1 || isLoading
                      ? 'cursor-not-allowed opacity-50'
                      : isDark
                        ? 'border-stone-600 text-stone-300 hover:bg-stone-700'
                        : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                  )}
                >
                  {t('pagination.previous')}
                </button>

                <span
                  className={cn(
                    'px-3 py-1.5 font-serif text-sm',
                    isDark ? 'text-stone-300' : 'text-stone-700'
                  )}
                >
                  {pagination.page} / {pagination.totalPages}
                </span>

                <button
                  onClick={() => loadUsers(pagination.page + 1, searchTerm)}
                  disabled={
                    pagination.page >= pagination.totalPages || isLoading
                  }
                  className={cn(
                    'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
                    pagination.page >= pagination.totalPages || isLoading
                      ? 'cursor-not-allowed opacity-50'
                      : isDark
                        ? 'border-stone-600 text-stone-300 hover:bg-stone-700'
                        : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                  )}
                >
                  {t('pagination.next')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
