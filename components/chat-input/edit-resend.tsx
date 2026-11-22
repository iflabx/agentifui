'use client';

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
  onSubmit: (text: string, source: EditSource) => Promise<boolean>;
}

function InlineMessageEditor({
  source,
  blocked,
  onSubmit,
  onCancel,
}: {
  source: EditSource;
  blocked: boolean;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useTranslations('components.chat.editResend');
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const [text, setText] = useState(source.text);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async () => {
    if (blocked || submitting.current || !text.trim()) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (!(await onSubmit(text))) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setPending(false);
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
        disabled={blocked || pending}
        aria-describedby={failed ? `${inputId}-error` : undefined}
        className="max-h-[60vh] min-h-24 w-full resize-y bg-transparent px-1 py-2 text-base leading-relaxed text-stone-800 outline-none dark:text-stone-100"
        onChange={event => {
          setText(event.target.value);
          setFailed(false);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && !pending) {
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
          disabled={pending}
          onClick={onCancel}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-stone-600"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={blocked || pending || !text.trim()}
          className="rounded-full bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-200 dark:text-stone-900"
        >
          {t(pending ? 'sending' : 'send')}
        </button>
      </div>
    </form>
  );
}

export function useEditResend(options: EditOptions) {
  const [selection, setSelection] = useState<{
    scope: string;
    source: EditSource;
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
        setSelection({ scope: options.scope, source });
      },
      editor: active ? (
        <InlineMessageEditor
          key={JSON.stringify([active.scope, active.source.id])}
          source={active.source}
          blocked={options.blocked}
          onCancel={() => setSelection(null)}
          onSubmit={async text => {
            if (
              sending.current ||
              live.current.blocked ||
              live.current.scope !== active.scope
            )
              return false;
            sending.current = true;
            try {
              const accepted = await live.current.onSubmit(text, active.source);
              if (accepted)
                setSelection(current => (current === active ? null : current));
              return accepted;
            } finally {
              sending.current = false;
            }
          }}
        />
      ) : null,
    }),
    [active, options.scope, options.blocked]
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
