import type { GroupMember } from '@lib/db/group-permissions';
import {
  DateFormatPresets,
  type useDateFormatter,
} from '@lib/hooks/use-date-formatter';
import { cn } from '@lib/utils';
import { Loader2, Mail, Trash2, User, Users } from 'lucide-react';

import type { useTranslations } from 'next-intl';

type MembersListTranslations = ReturnType<typeof useTranslations>;
type FormatDateFn = ReturnType<typeof useDateFormatter>['formatDate'];

interface MembersListProps {
  filteredMembers: GroupMember[];
  formatDate: FormatDateFn;
  isDark: boolean;
  isLoading: boolean;
  onRemoveMember: (member: GroupMember) => void;
  searchTerm: string;
  t: MembersListTranslations;
}

export function GroupMembersList({
  filteredMembers,
  formatDate,
  isDark,
  isLoading,
  onRemoveMember,
  searchTerm,
  t,
}: MembersListProps) {
  if (isLoading) {
    return (
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
    );
  }

  if (filteredMembers.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border p-12 text-center',
          isDark
            ? 'border-stone-700 bg-stone-800'
            : 'border-stone-200 bg-stone-50'
        )}
      >
        <Users
          className={cn(
            'mx-auto mb-4 h-12 w-12',
            isDark ? 'text-stone-400' : 'text-stone-500'
          )}
        />
        <h3
          className={cn(
            'mb-2 font-serif text-lg font-semibold',
            isDark ? 'text-stone-200' : 'text-stone-800'
          )}
        >
          {searchTerm ? t('noSearchResults') : t('noMembers')}
        </h3>
        <p
          className={cn(
            'font-serif text-sm',
            isDark ? 'text-stone-400' : 'text-stone-600'
          )}
        >
          {searchTerm ? t('noSearchResultsHint') : t('noMembersHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {filteredMembers.map(member => {
        const user = member.user;
        if (!user) {
          return null;
        }

        return (
          <div
            key={member.id}
            className={cn(
              'flex items-center justify-between rounded-xl border p-4 transition-all duration-200',
              isDark
                ? 'hover:bg-stone-750 border-stone-700 bg-stone-800 hover:border-stone-600'
                : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
            )}
          >
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-xl font-serif font-semibold',
                  isDark
                    ? 'bg-stone-600 text-stone-200'
                    : 'bg-stone-200 text-stone-700'
                )}
              >
                {user.full_name?.[0] || user.username?.[0] || (
                  <User className="h-5 w-5" />
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
                    {user.full_name || user.username || t('unknownUser')}
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

                <div className="mt-1 flex items-center gap-4 text-sm">
                  {user.email && (
                    <div className="flex items-center gap-1">
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

                  <span
                    className={cn(
                      'font-serif',
                      isDark ? 'text-stone-500' : 'text-stone-500'
                    )}
                  >
                    {t('joinedAt')}{' '}
                    {formatDate(member.created_at, DateFormatPresets.dateTime)}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onRemoveMember(member)}
              disabled={isLoading}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isDark
                  ? 'text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:hover:bg-transparent'
                  : 'text-red-600 hover:bg-red-50 hover:text-red-700 disabled:hover:bg-transparent'
              )}
              title={t('removeMember')}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
