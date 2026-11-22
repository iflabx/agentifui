'use client';

import {
  useEditResend,
  useRegisterDifyEdit,
} from '@components/chat-input/edit-resend';
import { useFocusManager } from '@components/chat-input/focus-manager';
import { ChatInputView } from '@components/chat-input/view';
import { FormField } from '@components/workflow/workflow-input-form/form-field';
import {
  capabilityFormFields,
  validateFormData,
} from '@components/workflow/workflow-input-form/validation';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import {
  formatChatUiError,
  isContentModerationBlocked,
  localizeChatModerationMessage,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import {
  useAgentInputCapabilities,
  useRetainedInputCapabilities,
} from '@lib/hooks/use-agent-input-capabilities';
import { useChatInputApp } from '@lib/hooks/use-chat-input-app';
import {
  registerChatInputSubmission,
  useChatInputRouteSync,
} from '@lib/hooks/use-chat-input-route-sync';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { useChatflowInitialInputs } from '@lib/hooks/use-chatflow-initial-inputs';
import { getDifyUserInputFormEntry } from '@lib/services/dify/user-input-form';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { cn } from '@lib/utils';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { useChatflowAttachments } from './chatflow-attachments';
import { buildChatflowFormConfig } from './chatflow-input-area/helpers';
import type {
  ChatflowFormData,
  UploadPayloadFile,
} from './chatflow-input-area/types';

interface ChatflowInputAreaProps {
  instanceId: string;
  onSubmit: (
    query: string,
    inputs: ChatflowFormData,
    files?: UploadPayloadFile[],
    editSourceId?: string,
    onInputAccepted?: () => void
  ) => Promise<unknown> | unknown;
  isProcessing?: boolean;
  isWaiting?: boolean;
  isWelcomeScreen?: boolean;
  onStop?: () => void;
  className?: string;
  onFormConfigChange?: (hasFormConfig: boolean) => void;
}

export function ChatflowInputArea(props: ChatflowInputAreaProps) {
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  return (
    <ScopedChatflowInputArea
      key={JSON.stringify([props.instanceId, actorEpoch])}
      {...props}
    />
  );
}

function ScopedChatflowInputArea({
  instanceId,
  onSubmit,
  isProcessing = false,
  isWaiting = false,
  isWelcomeScreen = true,
  onStop,
  className,
  onFormConfigChange,
}: ChatflowInputAreaProps) {
  const t = useTranslations('pages.chatflow');
  const tChat = useTranslations('pages.chat');
  const tWorkflow = useTranslations('pages.workflow.form');
  const tCommon = useTranslations('common');
  const tModeration = useTranslations('errors.system.moderation');
  const { session, loading } = useAuthSession();
  const route = useChatInputRouteSync({
    userId: session?.user.id,
    appId: instanceId,
    authLoading: loading,
  });
  const app = useChatInputApp(instanceId, route.ready);
  const live = useAgentInputCapabilities(app.instance?.id ?? null);
  const displayed = useRetainedInputCapabilities(live.capabilities);
  const ready = route.ready && live.capabilities?.status === 'ready';
  const { widthClass } = useChatWidth();
  const { message, setMessage, currentRoute } = useChatInputStore();
  const messages = useChatStore(state => state.messages);
  const continuing = Boolean(
    route.ready &&
    (JSON.parse(currentRoute)[3]?.startsWith('conversation:') ||
      (!isWelcomeScreen && messages.some(item => item.isUser)))
  );
  const fields = useMemo(
    () =>
      capabilityFormFields(displayed).filter(
        item =>
          !['file', 'file-list'].includes(
            getDifyUserInputFormEntry(item).fieldType
          )
      ),
    [displayed]
  );
  const { userInputForm, initialFormData } = useMemo(
    () => buildChatflowFormConfig(fields),
    [fields]
  );
  const [drafts, setDrafts] = useState<Record<string, ChatflowFormData>>({});
  const formData = useMemo(
    () => ({ ...initialFormData, ...drafts[currentRoute] }),
    [initialFormData, drafts, currentRoute]
  );
  const validation = continuing
    ? {}
    : validateFormData(formData, userInputForm, tWorkflow);
  const slots = useMemo(
    () =>
      (displayed?.attachmentSlots ?? []).filter(
        slot => !continuing || slot.target === 'files'
      ),
    [displayed, continuing]
  );
  const attachments = useChatflowAttachments({
    scope: route.ready ? currentRoute : null,
    instanceId,
    userId: session?.user.id,
    slots,
    disabled: !ready || isWaiting || isProcessing,
    onRequirementsChanged: live.retry,
  });
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const pending = useChatInputStore(
    state =>
      pendingScope !== null &&
      state.resolveScope(pendingScope) === state.currentRoute
  );
  const locks = useRef(new Set<string>());
  const disabled = !ready || !session;
  const waiting = isWaiting || pending;
  const sourceIds = messages.flatMap(item =>
    item.db_id ? [item.id, item.db_id] : [item.id]
  );
  const editScope = continuing && route.ready ? currentRoute : null;
  const edit = useEditResend({
    sourceIds,
    scope: editScope,
    blocked: disabled || waiting || isProcessing,
    onSubmit: async (text, source) => {
      const state = useChatInputStore.getState();
      if (
        !editScope ||
        state.currentRoute !== editScope ||
        state.actorId !== session?.user.id ||
        locks.current.has(editScope)
      )
        return false;
      const saved = useChatStore
        .getState()
        .messages.find(
          item => item.id === source.id || item.db_id === source.id
        );
      locks.current.add(editScope);
      setPendingScope(editScope);
      const unregister = registerChatInputSubmission(editScope);
      try {
        const result = await onSubmit(
          text,
          {},
          undefined,
          saved?.db_id || source.id
        );
        return isChatSubmitResult(result)
          ? (result.editResult ?? result.ok)
          : false;
      } finally {
        unregister();
        locks.current.delete(editScope);
        setPendingScope(scope => (scope === editScope ? null : scope));
      }
    },
  });
  useRegisterDifyEdit(editScope ? edit.controls : null);
  useEffect(() => {
    onFormConfigChange?.(fields.length > 0 || slots.length > 0);
  }, [fields.length, slots.length, onFormConfigChange]);

  const inputNode = useRef<HTMLTextAreaElement | null>(null);
  const registeredRef = useRef<{ current: HTMLTextAreaElement } | null>(null);
  const inputRef = useCallback((node: HTMLTextAreaElement | null) => {
    inputNode.current = node;
    if (node) {
      registeredRef.current = { current: node };
      useFocusManager.getState().registerRef(registeredRef.current);
    } else if (useFocusManager.getState().inputRef === registeredRef.current) {
      useFocusManager.getState().unregisterRef();
      registeredRef.current = null;
    }
  }, []);
  useEffect(() => {
    const container = inputNode.current?.closest('[data-chat-input-container]');
    if (!container) return;
    const measure = () =>
      useChatLayoutStore
        .getState()
        .setInputHeight(container.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const validQuery = !displayed?.text.required || Boolean(message.trim());
  const canSubmit =
    !disabled &&
    !edit.active &&
    !attachments.blocked &&
    !Object.keys(validation).length &&
    validQuery &&
    message.length <= 2000;
  const submit = async () => {
    const state = useChatInputStore.getState();
    const snapshot = state.snapshot();
    if (
      !canSubmit ||
      waiting ||
      isProcessing ||
      locks.current.has(snapshot.scope)
    )
      return;
    const actor = session!.user.id;
    const epoch = state.actorEpoch;
    locks.current.add(snapshot.scope);
    setPendingScope(snapshot.scope);
    const unregister = registerChatInputSubmission(snapshot.scope);
    const consume = () => {
      useChatInputStore.getState().consumeSnapshot(snapshot);
      attachments.consume();
    };
    const isCurrent = () => {
      const current = useChatInputStore.getState();
      return (
        current.actorId === actor &&
        current.actorEpoch === epoch &&
        current.resolveScope(snapshot.scope) === current.currentRoute
      );
    };
    try {
      const result = await onSubmit(
        snapshot.message,
        continuing ? {} : { ...formData, ...attachments.inputs },
        attachments.files,
        undefined,
        consume
      );
      if (isChatSubmitResult(result) && result.ok) consume();
      if (isChatSubmitResult(result) && !result.ok) {
        live.retry();
        const moderated = isContentModerationBlocked(result.errorCode);
        if (moderated) consume();
        const failure =
          localizeChatModerationMessage(
            {
              code: result.errorCode || 'REQUEST_FAILED',
              developerMessage: result.errorMessage,
            },
            (key, values) => tModeration(key, values)
          ) ||
          result.errorMessage ||
          tChat('input.messageSendFailed');
        if (isCurrent() && !result.surfaced)
          useNotificationStore
            .getState()
            .showNotification(failure, moderated ? 'warning' : 'error', 5000);
      }
    } catch (error) {
      live.retry();
      const failure = formatChatUiError(
        error,
        tChat('input.messageSendFailed'),
        'frontend',
        { moderationT: (key, values) => tModeration(key, values) }
      );
      const moderated = isContentModerationBlocked(failure.errorCode);
      if (moderated) consume();
      if (isCurrent())
        useNotificationStore
          .getState()
          .showNotification(
            failure.errorMessage,
            moderated ? 'warning' : 'error',
            5000
          );
    } finally {
      unregister();
      locks.current.delete(snapshot.scope);
      setPendingScope(scope => (scope === snapshot.scope ? null : scope));
    }
  };

  const failed =
    app.failed ||
    live.error ||
    (live.capabilities && live.capabilities.status !== 'ready');
  const localInitialInputs = messages.find(
    item => item.isUser && item.metadata?.chatflow_initial_inputs
  )?.metadata?.chatflow_initial_inputs;
  const hasInitialSettings =
    fields.length > 0 ||
    displayed?.attachmentSlots.some(slot => slot.target === 'inputs');
  const initial = useChatflowInitialInputs(
    continuing && hasInitialSettings ? currentRoute : null,
    localInitialInputs
  );
  const initialInputs = initial.value;
  const parameters = (
    <div className="mb-3 space-y-3 text-sm text-stone-600 dark:text-stone-300">
      {isWelcomeScreen && (
        <header className="mb-6 text-center">
          <h1 className="font-serif text-2xl text-stone-900 dark:text-stone-100">
            {app.instance?.display_name}
          </h1>
          {app.instance?.description && (
            <p className="mt-2">{app.instance.description}</p>
          )}
        </header>
      )}
      {failed ? (
        <div role="alert">
          {tChat('input.capabilitiesUnavailable')}{' '}
          <button
            type="button"
            className="underline"
            onClick={app.failed ? app.retry : live.retry}
          >
            {tCommon('ui.retry')}
          </button>
        </div>
      ) : !ready ? (
        <p role="status">{tCommon('ui.loading')}</p>
      ) : null}
      {continuing && hasInitialSettings ? (
        <details>
          <summary className="cursor-pointer">
            {t('composer.parameters')}
          </summary>
          <p className="mt-2">{t('composer.initialized')}</p>
          {initialInputs &&
          typeof initialInputs === 'object' &&
          !Array.isArray(initialInputs) ? (
            <dl>
              {fields.map(item => {
                const { fieldConfig } = getDifyUserInputFormEntry(item);
                if (!fieldConfig) return null;
                const value = (initialInputs as Record<string, unknown>)[
                  fieldConfig.variable
                ];
                return typeof value === 'string' ||
                  typeof value === 'number' ? (
                  <div key={fieldConfig.variable} className="mt-1 flex gap-2">
                    <dt>{fieldConfig.label}:</dt>
                    <dd className="break-words">{String(value)}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          ) : initial.loading ? (
            <p role="status">{tCommon('ui.loading')}</p>
          ) : initial.failed ? (
            <p role="alert">
              {tChat('input.capabilitiesUnavailable')}{' '}
              <button
                type="button"
                className="underline"
                onClick={initial.retry}
              >
                {tCommon('ui.retry')}
              </button>
            </p>
          ) : (
            <p>{t('composer.initialMissing')}</p>
          )}
          {displayed?.attachmentSlots.some(
            slot => slot.target === 'inputs'
          ) && <p>{t('composer.initialFiles')}</p>}
        </details>
      ) : !continuing && fields.length > 0 ? (
        <details open={Object.keys(validation).length > 0 || undefined}>
          <summary className="cursor-pointer">
            {t('composer.parameters')}
            {Object.keys(validation).length > 0 &&
              ` (${t('composer.requiredRemaining', { count: Object.keys(validation).length })})`}
          </summary>
          <fieldset
            disabled={disabled || waiting || isProcessing}
            className="mt-3 max-h-[30vh] space-y-3 overflow-y-auto"
          >
            {userInputForm.map(item => {
              const { fieldType, fieldConfig } =
                getDifyUserInputFormEntry(item);
              if (!fieldConfig) return null;
              return (
                <FormField
                  key={fieldConfig.variable}
                  type={
                    fieldType as React.ComponentProps<typeof FormField>['type']
                  }
                  config={fieldConfig}
                  value={
                    formData[fieldConfig.variable] as React.ComponentProps<
                      typeof FormField
                    >['value']
                  }
                  onChange={value =>
                    setDrafts(previous => ({
                      ...previous,
                      [currentRoute]: {
                        ...previous[currentRoute],
                        [fieldConfig.variable]: value,
                      },
                    }))
                  }
                  error={validation[fieldConfig.variable]}
                />
              );
            })}
          </fieldset>
        </details>
      ) : null}
    </div>
  );

  return (
    <div
      data-chatflow-composer
      className={cn(
        isWelcomeScreen &&
          'absolute inset-0 flex flex-col justify-center overflow-y-auto px-4 py-6'
      )}
    >
      <ChatInputView
        value={route.ready ? message : ''}
        onValueChange={setMessage}
        onSubmit={submit}
        disabled={disabled || edit.active}
        stopDisabled={!route.ready || !session}
        canSubmit={canSubmit}
        isProcessing={isProcessing}
        onStop={onStop}
        isWaiting={waiting}
        className={cn(
          'w-[calc(100%-2rem)]',
          isWelcomeScreen && 'mx-auto w-full',
          className
        )}
        embedded={isWelcomeScreen}
        widthClass={widthClass}
        placeholder={t('form.question.placeholder')}
        beforeInput={parameters}
        attachmentAction={attachments.action}
        attachmentPreview={attachments.preview}
        onInputRef={inputRef}
        editNotice={
          attachments.errors.length > 0 ? (
            <p
              role="alert"
              className="px-4 py-2 text-sm text-amber-700 dark:text-amber-300"
            >
              {attachments.errors.join(' ')}
            </p>
          ) : undefined
        }
      />
    </div>
  );
}
