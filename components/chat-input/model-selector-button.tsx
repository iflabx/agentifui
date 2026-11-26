'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@components/ui/select';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useChatStore } from '@lib/stores/chat-store';
import { cn } from '@lib/utils';
import { Loader2 } from 'lucide-react';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { useFocusManager } from './focus-manager';

const LAST_USED_MODEL = 'last-used-model-app-id';

function readLastUsedModel() {
  try {
    return localStorage.getItem(LAST_USED_MODEL);
  } catch {
    return null;
  }
}

function rememberModel(instanceId: string) {
  try {
    localStorage.setItem(LAST_USED_MODEL, instanceId);
  } catch {
    return;
  }
}

interface ModelSelectorButtonProps {
  className?: string;
  disabled?: boolean;
}

export function ModelSelectorButton({
  className,
  disabled,
}: ModelSelectorButtonProps) {
  const { currentAppId, switchToSpecificApp, isValidating } = useCurrentApp();
  const { apps, fetchApps, isLoading } = useAppListStore();
  const clearMessages = useChatStore(state => state.clearMessages);
  const focusInput = useFocusManager(state => state.focusInput);
  const [switching, setSwitching] = useState(false);
  const t = useTranslations('pages.chat.modelSelector');

  useEffect(() => {
    void fetchApps();
  }, [fetchApps]);

  const models = apps.filter(
    app => app.config?.app_metadata?.app_type === 'model'
  );
  const current = models.find(app => app.instance_id === currentAppId);
  const fallbackId = current
    ? undefined
    : (models.find(app => app.instance_id === readLastUsedModel()) ?? models[0])
        ?.instance_id;

  useEffect(() => {
    if (!disabled && currentAppId && fallbackId) {
      void switchToSpecificApp(fallbackId)
        .then(() => rememberModel(fallbackId))
        .catch(error => console.warn('Silent model recovery failed:', error));
    }
  }, [currentAppId, disabled, fallbackId, switchToSpecificApp]);

  const handleModelChange = async (instanceId: string) => {
    if (disabled || switching || isValidating || currentAppId === instanceId)
      return;
    setSwitching(true);
    try {
      await switchToSpecificApp(instanceId);
      rememberModel(instanceId);
      clearMessages();
    } catch (error) {
      console.error('Switch app failed:', error);
    } finally {
      setSwitching(false);
      setTimeout(focusInput, 0);
    }
  };

  if (isLoading && !models.length) {
    return (
      <div
        className={cn(
          'h-4 w-16 animate-pulse rounded bg-stone-300/60 sm:w-20 md:w-24 dark:bg-stone-500/60',
          className
        )}
      />
    );
  }

  const label =
    current?.display_name ||
    current?.instance_id ||
    (models.length ? t('selectModel') : t('noModelsAvailable'));

  return (
    <Select
      value={current?.instance_id ?? ''}
      onValueChange={instanceId => void handleModelChange(instanceId)}
      disabled={disabled || switching || isValidating || !models.length}
    >
      <SelectTrigger
        className={cn(
          'h-8 w-auto max-w-full gap-1 border-none bg-transparent px-2 py-1 text-stone-600 hover:bg-stone-100 dark:bg-transparent dark:text-stone-300 dark:hover:bg-stone-800/50',
          className
        )}
        aria-label={t('selectModel')}
        title={label}
      >
        <span className="min-w-0 truncate">{label}</span>
        {(switching || isValidating) && (
          <Loader2
            aria-hidden="true"
            className="h-3 w-3 shrink-0 animate-spin"
          />
        )}
      </SelectTrigger>
      <SelectContent
        side="top"
        align="end"
        collisionPadding={16}
        className="max-h-[min(12rem,var(--radix-select-content-available-height))] max-w-[min(16rem,calc(100vw-2rem))]"
      >
        {models.map(app => (
          <SelectItem
            key={app.id}
            value={app.instance_id}
            className="break-words"
          >
            {app.display_name || app.instance_id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
