'use client';

import { FILE_TYPE_CONFIG, FileTypeKey } from '@lib/constants/file-types';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import type { ServiceInstance } from '@lib/types/database';
import { formatBytes } from '@lib/utils';

import React, { useMemo } from 'react';

import {
  type AgentAttachmentSlot,
  INPUT_FILE_EXTENSIONS,
  validateInputFile,
} from '../../packages/shared/src/agent-input';
import { useAgentInputCapabilities } from './use-agent-input-capabilities';

export interface FileType {
  title: string;
  extensions: string[];
  icon: React.ReactNode;
  acceptString: string;
  maxSize: string;
}

export interface FileUploadConfig {
  enabled: boolean;
  maxFiles: number;
  supportedMethods: ('local_file' | 'remote_url')[];
  hasFileTypes: boolean;
  allowedExtensions: string[];
}

export function fileTypesForSlot(slot?: AgentAttachmentSlot): FileType[] {
  if (!slot || slot.maxCount === 0 || !slot.methods.includes('local_file'))
    return [];
  return slot.allowedTypes.flatMap(type => {
    const extensions = (
      type === 'custom' ? slot.extensions : INPUT_FILE_EXTENSIONS[type]
    ).filter(
      extension =>
        !validateInputFile(slot, {
          name: `file.${extension}`,
          size: 0,
          type: type === 'video' ? 'video/mpeg' : undefined,
        })
    );
    const limit = slot.maxBytesByType[type];
    if (!extensions.length || limit === undefined) return [];
    const title: FileTypeKey = type === 'custom' ? 'other' : type;
    return [
      {
        title,
        extensions: [...extensions],
        icon: React.createElement(FILE_TYPE_CONFIG[title].icon, {
          className: 'h-4 w-4',
        }),
        acceptString: extensions.map(extension => `.${extension}`).join(','),
        maxSize: formatBytes(limit),
      },
    ];
  });
}

export function useFileTypesFromConfig(
  resolvedInstance?: ServiceInstance | null
) {
  const selected = useCurrentAppStore();
  const instance =
    resolvedInstance === undefined
      ? selected.currentAppInstance
      : resolvedInstance;
  const live = useAgentInputCapabilities(instance?.id ?? null);
  const capabilities = useMemo(
    () =>
      live.capabilities &&
      instance?.config?.interaction_protocol === 'ag-ui/1.0'
        ? { ...live.capabilities, attachmentSlots: [] }
        : live.capabilities,
    [live.capabilities, instance?.config?.interaction_protocol]
  );
  const slots =
    capabilities?.status === 'ready'
      ? capabilities.attachmentSlots.filter(slot => slot.target === 'files')
      : [];
  const slot = slots.length === 1 ? slots[0] : undefined;
  const fileTypes = useMemo(() => fileTypesForSlot(slot), [slot]);
  return {
    ...live,
    capabilities,
    slot,
    fileTypes,
    uploadConfig: {
      enabled: fileTypes.length > 0,
      maxFiles: slot?.maxCount ?? 0,
      supportedMethods:
        slot?.methods.filter(method => method === 'local_file') ?? [],
      hasFileTypes: fileTypes.length > 0,
      allowedExtensions: slot?.extensions ?? [],
    } satisfies FileUploadConfig,
  };
}
