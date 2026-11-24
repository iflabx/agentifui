'use client';

import { ChatMessage } from '@components/chat/session/chat-message';
import { ChatSessionHeader } from '@components/chat/session/chat-session-header';
import { ChatSessionView } from '@components/chat/session/chat-session-view';
import {
  useFollowChatOutput,
  useRunProcessSelection,
} from '@components/chat/session/use-session-presentation';
import {
  WorkflowInputForm,
  type WorkflowInputFormRef,
} from '@components/workflow/workflow-input-form';
import { extractWorkflowInputAttachments } from '@components/workflow/workflow-tracker/input-attachments';
import { ResultViewer } from '@components/workflow/workflow-tracker/result-viewer';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { useTextGenerationExecution } from '@lib/hooks/use-text-generation-execution';
import { useWorkflowExecution } from '@lib/hooks/use-workflow-execution';
import {
  type TaskExecutionReservation,
  getConversationExecutions,
  reserveTaskExecution,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import { moveTaskDraft, taskDraftKey } from '@lib/stores/chat-draft-session';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution, ExecutionType } from '@lib/types/database';
import { cn } from '@lib/utils';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  hasDetailedTaskResult,
  mergeTaskExecutions,
  taskInputText,
  taskOutputText,
} from './projection';
import { TaskActions } from './task-actions';
import { TaskProcess } from './task-process';

interface TaskChatProps {
  instanceId?: string;
  appId?: string;
  conversationId?: string | null;
  taskType: ExecutionType;
}

export function TaskChat(props: TaskChatProps) {
  const [adopted, setAdopted] = useState<{
    actorId: string;
    appId: string;
    id: string;
  } | null>(null);
  const [route, setRoute] = useState<{
    actorId: string;
    appId: string;
    conversationId: string | null;
    generation: number;
  } | null>(null);
  const { session, loading } = useAuthSession();
  const sessionId = useChatInputStore(state =>
    state.actorId === session?.user.id
      ? (state.actorSessionId ?? undefined)
      : undefined
  );
  const apps = useAppListStore(state => state.apps);
  const fetchApps = useAppListStore(state => state.fetchApps);
  const t = useTranslations('taskChat');
  useEffect(() => {
    if (session && apps.length === 0) void fetchApps();
  }, [session, apps.length, fetchApps]);
  if (loading && !session) return <p role="status">{t('loading')}</p>;
  if (!session) return <a href="/login">{t('loginRequired')}</a>;
  const app = apps.find(item =>
    props.appId
      ? item.id === props.appId
      : item.instance_id === props.instanceId
  );
  if (!app) return <p role="status">{t('unavailable')}</p>;
  const nextId = props.conversationId ?? null;
  if (
    route?.actorId !== session.user.id ||
    route.appId !== app.id ||
    route.conversationId !== nextId
  ) {
    const adopting =
      route?.actorId === session.user.id &&
      route.appId === app.id &&
      route.conversationId === null &&
      adopted?.actorId === session.user.id &&
      adopted.appId === app.id &&
      adopted.id === nextId;
    setRoute({
      actorId: session.user.id,
      appId: app.id,
      conversationId: nextId,
      generation: (route?.generation ?? 0) + (adopting ? 0 : 1),
    });
    if (!adopting && adopted) setAdopted(null);
  }
  const common = {
    ...props,
    appId: app.id,
    appName: app.display_name || app.instance_id,
    instanceId: app.instance_id,
    actorId: session.user.id,
    sessionId,
    executionEnabled: app.config?.app_metadata?.dify_apptype === props.taskType,
    onReserved: (id: string) => {
      if (!props.conversationId)
        setAdopted({ actorId: session.user.id, appId: app.id, id });
    },
  };
  const key = JSON.stringify([session.user.id, app.id, route?.generation]);
  return props.taskType === 'workflow' ? (
    <WorkflowTaskChat key={key} {...common} />
  ) : (
    <CompletionTaskChat key={key} {...common} />
  );
}

type ResolvedProps = TaskChatProps & {
  appId: string;
  appName: string;
  instanceId: string;
  actorId: string;
  sessionId?: string;
  executionEnabled: boolean;
  onReserved: (id: string) => void;
};
type TaskRunner = {
  isExecuting: boolean;
  currentExecution: AppExecution | null;
  error: string | null;
  generatedText?: string;
  stop?: () => void;
  execute: (
    inputs: Record<string, unknown>,
    reservation?: TaskExecutionReservation
  ) => Promise<boolean>;
};

function WorkflowTaskChat(props: ResolvedProps) {
  const execution = useWorkflowExecution(props.instanceId, true);
  return (
    <TaskChatSession
      {...props}
      runner={{
        ...execution,
        execute: execution.executeWorkflow,
        stop: execution.canStop ? execution.stopWorkflowExecution : undefined,
      }}
    />
  );
}

function CompletionTaskChat(props: ResolvedProps) {
  const execution = useTextGenerationExecution(props.instanceId, true);
  return (
    <TaskChatSession
      {...props}
      runner={{
        ...execution,
        execute: execution.executeTextGeneration,
        stop: execution.stopTextGeneration,
      }}
    />
  );
}

function TaskChatSession({
  appId,
  appName,
  instanceId,
  conversationId: initialConversationId,
  actorId,
  sessionId,
  executionEnabled,
  onReserved,
  runner,
}: ResolvedProps & { runner: TaskRunner }) {
  const t = useTranslations('taskChat');
  const { widthClass, paddingClass } = useChatWidth();
  const [conversationId, setConversationId] = useState(
    initialConversationId ?? null
  );
  const draftKey = taskDraftKey(actorId, sessionId, appId, conversationId);
  const [executions, setExecutions] = useState<AppExecution[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialConversationId));
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(
    null
  );
  const [result, setResult] = useState<AppExecution | null>(null);
  const form = useRef<WorkflowInputFormRef>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const submission = useRef<{ id: string; signature: string } | null>(null);
  const nodes = useWorkflowExecutionStore(state => state.nodes);
  const scroll = useFollowChatOutput({
    scope: conversationId,
    messages: executions,
    activity: nodes,
    streamedText: runner.generatedText,
  });
  const process = useRunProcessSelection(conversationId, id =>
    executions.some(execution => execution.id === id)
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  const load = useCallback(
    async (older?: string) => {
      if (!conversationId) return;
      const version = ++request.current;
      setLoading(true);
      try {
        const response = await getConversationExecutions(conversationId, older);
        if (!mounted.current || version !== request.current) return;
        if (!response.success) throw response.error;
        setExecutions(previous =>
          mergeTaskExecutions(previous, response.data.executions)
        );
        setCursor(response.data.nextCursor);
        setHasMore(response.data.hasMore);
        setLoadFailed(false);
      } catch {
        if (mounted.current && version === request.current) setLoadFailed(true);
      } finally {
        if (mounted.current && version === request.current) setLoading(false);
      }
    },
    [conversationId]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const current = runner.currentExecution;
    if (
      current?.conversation_id === conversationId &&
      current?.user_id === actorId
    )
      setExecutions(previous => mergeTaskExecutions(previous, [current]));
  }, [runner.currentExecution, conversationId, actorId]);
  const busy = submitting || runner.isExecuting;
  const unresolved =
    !busy &&
    executions.some(execution =>
      ['pending', 'running'].includes(execution.status)
    );
  const welcome =
    executionEnabled && !conversationId && executions.length === 0;
  const prepareAgain = async (execution: AppExecution) => {
    if (busy || loadFailed) return;
    if (['pending', 'running'].includes(execution.status)) {
      const interrupted = await updateExecutionStatus(
        execution.id,
        'stopped',
        'CLIENT_TASK_INTERRUPTED',
        new Date().toISOString()
      );
      if (!mounted.current) return;
      if (!interrupted.success || !interrupted.data) {
        setError(t('historyFailed'));
        return;
      }
      const updates = {
        status: 'stopped' as const,
        error_message: 'CLIENT_TASK_INTERRUPTED',
        updated_at: new Date().toISOString(),
      };
      setExecutions(previous =>
        mergeTaskExecutions(previous, [{ ...execution, ...updates }])
      );
      if (runner.currentExecution?.id === execution.id)
        useWorkflowExecutionStore.getState().updateCurrentExecution(updates);
    }
    form.current?.restoreInputs?.(execution.inputs);
  };
  const execute = async (inputs: Record<string, unknown>) => {
    if (busy || loadFailed || unresolved || !executionEnabled) return false;
    const signature = JSON.stringify([conversationId, inputs]);
    if (!submission.current || submission.current.signature !== signature)
      submission.current = { id: crypto.randomUUID(), signature };
    const submissionId = submission.current.id;
    setSubmitting(true);
    setError(null);
    try {
      const reserved = await reserveTaskExecution({
        serviceInstanceId: appId,
        submissionId,
        inputs,
        ...(conversationId ? { conversationId } : {}),
        title: taskInputText(inputs).slice(0, 100) || t('taskTitle'),
      });
      if (!mounted.current) return false;
      if (!reserved.success) throw reserved.error;
      const saved = reserved.data;
      moveTaskDraft(
        draftKey,
        taskDraftKey(actorId, sessionId, appId, saved.conversationId)
      );
      onReserved(saved.conversationId);
      setConversationId(saved.conversationId);
      const url = new URL(window.location.href);
      if (url.pathname.startsWith('/apps/')) {
        url.searchParams.set('conversationId', saved.conversationId);
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}`
        );
      }
      setExecutions(previous =>
        mergeTaskExecutions(previous, [saved.execution])
      );
      conversationEvents.emit();
      if (saved.replayed) {
        setError(t('replayed'));
        submission.current = null;
        return false;
      }
      setActiveExecutionId(saved.execution.id);
      const accepted = await runner.execute(inputs, {
        execution: saved.execution,
        submissionId,
      });
      if (!mounted.current) return accepted;
      submission.current = null;
      return accepted;
    } catch {
      if (mounted.current) setError(t('submitFailed'));
      return false;
    } finally {
      if (mounted.current) {
        setSubmitting(false);
        setActiveExecutionId(null);
      }
    }
  };
  return (
    <ChatSessionView
      as="main"
      className="pt-16 md:pt-12"
      contentClassName=""
      jumpToBottom={false}
      backdrop={false}
      filePreview
      header={<ChatSessionHeader title={appName} />}
      showWelcome={welcome}
      scrollProps={scroll}
      composer={
        <div
          data-task-chat={welcome ? '' : undefined}
          className={cn(
            'mx-auto w-full shrink-0 pb-4',
            welcome && 'flex min-h-0 flex-1 flex-col overflow-y-auto py-6',
            widthClass,
            paddingClass
          )}
        >
          <div className={welcome ? 'my-auto shrink-0' : undefined}>
            {(error || runner.error) && (
              <p role="alert" className="mb-2 text-sm text-red-600">
                {error ||
                  (runner.error === 'TASK_OUTCOME_UNKNOWN'
                    ? t('unknown')
                    : runner.error)}
              </p>
            )}
            <WorkflowInputForm
              ref={form}
              instanceId={instanceId}
              chat
              draftKey={draftKey}
              showIntroduction={welcome}
              onExecute={execute}
              isExecuting={
                busy || loading || loadFailed || unresolved || !executionEnabled
              }
              onStop={runner.isExecuting ? runner.stop : undefined}
            />
          </div>
        </div>
      }
      preview={
        result && (
          <ResultViewer
            result={{ outputs: result.outputs }}
            execution={result}
            appId={instanceId}
            onClose={() => setResult(null)}
          />
        )
      }
    >
      <div data-task-chat>
        {!executionEnabled && <p role="alert">{t('unavailable')}</p>}
        <div className={cn('mx-auto w-full py-6', widthClass, paddingClass)}>
          {hasMore && (
            <button
              disabled={loading}
              onClick={() => {
                if (cursor) void load(cursor);
              }}
              className="mb-4 text-sm underline"
            >
              {t('loadOlder')}
            </button>
          )}
          {loading && <p role="status">{t('loading')}</p>}
          {loadFailed && (
            <p role="alert">
              {t('historyFailed')}{' '}
              <button onClick={() => void load()} className="underline">
                {t('retry')}
              </button>
            </p>
          )}
          {executions.map(execution => {
            const live = busy && activeExecutionId === execution.id;
            const unknown =
              !live &&
              (['pending', 'running'].includes(execution.status) ||
                execution.error_message === 'CLIENT_TASK_INTERRUPTED');
            const output =
              live && runner.generatedText
                ? runner.generatedText
                : taskOutputText(execution.outputs);
            return (
              <section
                key={execution.id}
                data-execution-id={execution.id}
                className="mb-8 min-w-0"
              >
                <ChatMessage
                  role="user"
                  id={`task-${execution.id}-input`}
                  content={
                    taskInputText(execution.inputs) || t('parameterTask')
                  }
                  attachments={extractWorkflowInputAttachments(
                    execution.inputs,
                    instanceId
                  )}
                  conversationAppId={instanceId}
                />
                <div className="min-w-0">
                  <TaskProcess
                    execution={execution}
                    live={live}
                    open={process.selected === execution.id}
                    onOpenChange={open => process.setOpen(execution.id, open)}
                  />
                  {output && (
                    <ChatMessage
                      role="assistant"
                      id={`task-${execution.id}-output`}
                      content={output}
                      isStreaming={live}
                      wasManuallyStopped={execution.status === 'stopped'}
                    />
                  )}
                  <p
                    role={execution.status === 'failed' ? 'alert' : 'status'}
                    className="text-xs text-stone-500"
                  >
                    {t(
                      unknown
                        ? 'unknown'
                        : live
                          ? 'running'
                          : execution.status === 'deleted'
                            ? 'unavailable'
                            : execution.status
                    )}
                  </p>
                  {execution.error_message &&
                    execution.error_message !== 'CLIENT_TASK_INTERRUPTED' && (
                      <p className="mt-2 text-sm text-red-600">
                        {execution.error_message}
                      </p>
                    )}
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    {['pending', 'running'].includes(execution.status) ? (
                      <button
                        type="button"
                        disabled={busy || loadFailed}
                        onClick={() => void prepareAgain(execution)}
                        className="underline"
                      >
                        {t('recoverTask')}
                      </button>
                    ) : (
                      <TaskActions
                        disabled={busy || loadFailed}
                        onReuse={() => void prepareAgain(execution)}
                      />
                    )}
                    {hasDetailedTaskResult(execution.outputs) && (
                      <button
                        onClick={() => setResult(execution)}
                        className="underline"
                      >
                        {t('viewResult')}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </ChatSessionView>
  );
}
