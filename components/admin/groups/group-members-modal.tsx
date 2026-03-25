'use client';

import { ConfirmDialog } from '@components/ui/confirm-dialog';
import type { Group, GroupMember } from '@lib/db/group-permissions';
import { useDateFormatter } from '@lib/hooks/use-date-formatter';
import { useTheme } from '@lib/hooks/use-theme';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import { cn } from '@lib/utils';
import { Plus, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AddMemberModal } from './group-members-modal/add-member-modal';
import { filterGroupMembers } from './group-members-modal/helpers';
import { GroupMembersList } from './group-members-modal/members-list';

interface GroupMembersModalProps {
  group: Group;
  isOpen: boolean;
  onClose: () => void;
}

export function GroupMembersModal({
  group,
  isOpen,
  onClose,
}: GroupMembersModalProps) {
  const { isDark } = useTheme();
  const { groupMembers, loading, loadGroupMembers, removeMember } =
    useGroupManagementStore();
  const { formatDate } = useDateFormatter();
  const t = useTranslations('pages.admin.groups.membersModal');

  const [showAddMember, setShowAddMember] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<GroupMember | null>(
    null
  );
  const [isRemoving, setIsRemoving] = useState(false);

  const members = groupMembers[group.id] || [];
  const filteredMembers = filterGroupMembers(members, searchTerm);

  useEffect(() => {
    if (isOpen && group.id) {
      loadGroupMembers(group.id);
      return;
    }

    if (!isOpen) {
      setSearchTerm('');
      setShowAddMember(false);
    }
  }, [group.id, isOpen, loadGroupMembers]);

  const handleRemoveMember = (member: GroupMember) => {
    if (!member.user) {
      return;
    }

    setMemberToRemove(member);
    setShowRemoveDialog(true);
  };

  const handleConfirmRemove = async () => {
    if (!memberToRemove?.user) {
      return;
    }

    const memberName =
      memberToRemove.user.full_name ||
      memberToRemove.user.username ||
      t('unknownUser');

    setIsRemoving(true);
    try {
      const success = await removeMember(group.id, memberToRemove.user_id);
      if (success) {
        toast.success(t('removeMemberSuccess', { memberName }));
        setShowRemoveDialog(false);
        setMemberToRemove(null);
      }
    } finally {
      setIsRemoving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={cn(
          'relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border shadow-lg',
          isDark ? 'border-stone-700 bg-stone-800' : 'border-stone-200 bg-white'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between border-b p-6',
            isDark ? 'border-stone-700' : 'border-stone-200'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl',
                isDark ? 'bg-stone-700' : 'bg-stone-100'
              )}
            >
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2
                className={cn(
                  'font-serif text-xl font-semibold',
                  isDark ? 'text-stone-100' : 'text-stone-900'
                )}
              >
                {t('title')}
              </h2>
              <p
                className={cn(
                  'font-serif text-sm',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('subtitle', {
                  groupName: group.name,
                  count: members.length,
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddMember(true)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-4 py-2 font-serif text-sm transition-all duration-200',
                isDark
                  ? 'bg-stone-600 text-white hover:bg-stone-500'
                  : 'bg-stone-700 text-white hover:bg-stone-600'
              )}
            >
              <Plus className="h-4 w-4" />
              {t('addMember')}
            </button>

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
        </div>

        <div className="p-6 pb-4">
          <div className="relative">
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
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <GroupMembersList
            filteredMembers={filteredMembers}
            formatDate={formatDate}
            isDark={isDark}
            isLoading={loading.members}
            onRemoveMember={handleRemoveMember}
            searchTerm={searchTerm}
            t={t}
          />
        </div>
      </div>

      {showAddMember && (
        <AddMemberModal
          group={group}
          isOpen={showAddMember}
          onClose={() => setShowAddMember(false)}
        />
      )}

      <ConfirmDialog
        isOpen={showRemoveDialog}
        onClose={() => !isRemoving && setShowRemoveDialog(false)}
        onConfirm={handleConfirmRemove}
        title={t('removeMember')}
        message={t('removeMemberConfirm', {
          memberName:
            memberToRemove?.user?.full_name ||
            memberToRemove?.user?.username ||
            t('unknownUser'),
          groupName: group.name,
        })}
        confirmText={t('removeMember')}
        variant="danger"
        icon="delete"
        isLoading={isRemoving}
      />
    </div>
  );
}
