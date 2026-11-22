'use client';

import type {
  EditRecoveryReceipt,
  EditSubmissionResult,
} from '@lib/types/message-edit';

import {
  type ReactNode,
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import type { MessageEditSource } from '../../packages/shared/src/message-edit';

export type EditSource = MessageEditSource;

interface EditOptions {
  scope: string | null;
  blocked: boolean;
  sourceIds?: string[];
  recovery?: EditRecoveryReceipt | null;
  restore?: { sourceId: string; text: string; submissionId: string };
  onSubmit: (text: string, source: EditSource) => Promise<EditSubmissionResult>;
}

function InlineMessageEditor({
  source,
  blocked,
  onSubmit,
  onCancel,
  text,
  onChange,
  failed,
}: {
  source: EditSource;
  blocked: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
  text: string;
  onChange: (text: string) => void;
  failed: boolean;
}) {
  const t = useTranslations('components.chat.editResend');
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async () => {
    if (blocked || submitting.current || !text.trim()) return;
    submitting.current = true;
    try {
      await onSubmit(text);
    } finally {
      submitting.current = false;
    }
  };
  return (
    <form
      aria-label={t('editorLabel')}
      className="w-full rounded-2xl border border-stone-300 bg-stone-100 p-3 dark:border-stone-600 dark:bg-stone-800"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {t('editorLabel')}
      </label>
      <textarea
        id={inputId}
        name="message-edit"
        ref={input}
        value={text}
        rows={4}
        disabled={blocked}
        aria-describedby={failed ? `${inputId}-error` : undefined}
        className="max-h-[60vh] min-h-24 w-full resize-y bg-transparent px-1 py-2 text-base leading-relaxed text-stone-800 outline-none dark:text-stone-100"
        onChange={event => {
          onChange(event.target.value);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && !submitting.current) {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {source.hasAttachments && (
        <p className="mb-2 text-sm text-stone-500">{t('textOnly')}</p>
      )}
      {failed && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="mb-2 text-sm text-red-600 dark:text-red-400"
        >
          {t('sendFailed')}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-stone-600"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={blocked || !text.trim()}
          className="rounded-full bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-200 dark:text-stone-900"
        >
          {t('send')}
        </button>
      </div>
    </form>
  );
}

export function useEditResend(options: EditOptions) {
  const t = useTranslations('components.chat.editResend');
  const [selection, setSelection] = useState<{
    scope: string;
    source: EditSource;
    text: string;
    failed?: boolean;
    pending?: boolean;
    unknown?: Exclude<EditSubmissionResult, boolean>;
  } | null>(null);
  const live = useRef(options);
  const sending = useRef(false);
  useLayoutEffect(() => {
    live.current = options;
  });
  useLayoutEffect(() => {
    setSelection(null);
  }, [options.scope]);
  const sourceVisible =
    !selection ||
    !options.sourceIds ||
    options.sourceIds.includes(selection.source.id);
  useLayoutEffect(() => {
    if (!sourceVisible) setSelection(null);
  }, [sourceVisible]);
  useLayoutEffect(() => {
    const restored = options.restore;
    const scope = options.scope;
    if (!scope || !restored || !options.sourceIds?.includes(restored.sourceId))
      return;
    setSelection(
      current =>
        current ?? {
          scope,
          source: { id: restored.sourceId, text: restored.text },
          text: restored.text,
          pending: true,
          unknown: { status: 'unknown', submissionId: restored.submissionId },
        }
    );
  }, [options.scope, options.restore?.submissionId, options.sourceIds]);
  useLayoutEffect(() => {
    const recovery = options.recovery;
    if (!recovery) return;
    setSelection(current =>
      current?.scope === options.scope &&
      current.unknown?.submissionId === recovery.submissionId
        ? recovery.accepted
          ? null
          : { ...current, pending: false, unknown: undefined, failed: true }
        : current
    );
  }, [options.recovery, options.scope, selection?.unknown?.submissionId]);
  const active =
    selection?.scope === options.scope && sourceVisible ? selection : null;
  const controls = useMemo(
    () => ({
      sourceId: active?.source.id,
      disabled: options.blocked || Boolean(active),
      start: (source: EditSource) => {
        if (
          !options.scope ||
          live.current.scope !== options.scope ||
          live.current.blocked ||
          active ||
          sending.current ||
          !source.text.trim()
        )
          return;
        setSelection({ scope: options.scope, source, text: source.text });
      },
      pending: active?.pending
        ? { sourceId: active.source.id, text: active.text }
        : null,
      editor: active?.pending ? (
        <div
          className="space-y-2 rounded-2xl bg-stone-100 px-4 py-3 dark:bg-stone-800"
          aria-busy={!active.unknown}
        >
          <p className="break-words whitespace-pre-wrap">{active.text}</p>
          <p role="status" className="text-sm text-stone-500">
            {t(active.unknown ? 'unconfirmed' : 'sending')}
          </p>
          {active.unknown?.check && (
            <button
              type="button"
              className="text-sm underline disabled:opacity-50"
              onClick={async event => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                  const accepted = await active.unknown!.check!();
                  if (accepted !== null)
                    setSelection(current =>
                      current === active && live.current.scope === active.scope
                        ? accepted
                          ? null
                          : {
                              ...current,
                              pending: false,
                              unknown: undefined,
                              failed: true,
                            }
                        : current
                    );
                } catch {
                  return;
                } finally {
                  button.disabled = false;
                }
              }}
            >
              {t('checkStatus')}
            </button>
          )}
        </div>
      ) : active ? (
        <InlineMessageEditor
          key={JSON.stringify([active.scope, active.source.id])}
          source={active.source}
          blocked={options.blocked}
          text={active.text}
          failed={Boolean(active.failed)}
          onChange={text =>
            setSelection(current =>
              current === active ? { ...current, text, failed: false } : current
            )
          }
          onCancel={() => setSelection(null)}
          onSubmit={async text => {
            if (
              sending.current ||
              live.current.blocked ||
              live.current.scope !== active.scope
            )
              return;
            sending.current = true;
            const attempt = { ...active, text, pending: true, failed: false };
            setSelection(attempt);
            try {
              const result = await live.current.onSubmit(text, active.source);
              setSelection(current =>
                current !== attempt || live.current.scope !== active.scope
                  ? current
                  : result === true
                    ? null
                    : result === false
                      ? { ...current, pending: false, failed: true }
                      : { ...current, unknown: result }
              );
            } catch {
              setSelection(current =>
                current === attempt
                  ? {
                      ...current,
                      unknown: { status: 'unknown', submissionId: '' },
                    }
                  : current
              );
            } finally {
              sending.current = false;
            }
          }}
        />
      ) : null,
    }),
    [active, options.scope, options.blocked, t]
  );
  return { controls, active: Boolean(active) };
}

type EditControls = ReturnType<typeof useEditResend>['controls'];
const EditContext = createContext<{
  controls: EditControls | null;
  register: (controls: EditControls | null) => void;
} | null>(null);

export function DifyEditProvider({ children }: { children: ReactNode }) {
  const [controls, register] = useState<EditControls | null>(null);
  const value = useMemo(() => ({ controls, register }), [controls]);
  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
}

export function useDifyEditControls() {
  return useContext(EditContext)?.controls;
}

export function useRegisterDifyEdit(controls: EditControls | null) {
  const register = useContext(EditContext)?.register;
  useLayoutEffect(() => {
    register?.(controls);
    return () => register?.(null);
  }, [register, controls]);
}
