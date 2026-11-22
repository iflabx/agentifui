'use client';

import { ConfirmDialog } from '@components/ui/confirm-dialog';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

export interface EditSource {
  id: string;
  text: string;
  hasAttachments?: boolean;
}

export function correctionDraft(
  source: string,
  labels: { original: string; replacement: string; guidance: string }
) {
  const points = Array.from(source);
  const excerpt =
    points.slice(0, 120).join('') + (points.length > 120 ? '…' : '');
  const prefix = `${labels.original}\n“${excerpt}”\n\n${labels.replacement}\n`;
  return {
    text: `${prefix}${source}\n\n${labels.guidance}`,
    selectionStart: prefix.length,
    selectionEnd: prefix.length + source.length,
  };
}

interface EditOptions {
  scope: string | null;
  value: string;
  blocked: boolean;
  hasDraftAttachments?: boolean;
  replace: (text: string) => boolean;
}

export function useEditResend(options: EditOptions) {
  const t = useTranslations('components.chat.editResend');
  const live = useRef(options);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const [pending, setPending] = useState<{
    scope: string;
    source: EditSource;
  } | null>(null);
  const [notice, setNotice] = useState<{
    scope: string;
    source: EditSource;
  } | null>(null);
  const [selection, setSelection] = useState<{
    scope: string;
    text: string;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);
  useLayoutEffect(() => {
    live.current = options;
  });
  useLayoutEffect(() => {
    setPending(null);
    setNotice(null);
    setSelection(null);
  }, [options.scope]);
  useLayoutEffect(() => {
    if (options.blocked) setPending(null);
  }, [options.blocked]);
  useLayoutEffect(() => {
    if (!options.value) setNotice(null);
    if (
      selection &&
      selection.scope === options.scope &&
      selection.text === options.value &&
      input.current
    ) {
      input.current.focus();
      input.current.setSelectionRange(
        selection.selectionStart,
        selection.selectionEnd
      );
      setSelection(null);
    }
  }, [options.value, options.scope, selection]);
  const apply = useCallback(
    (request: { scope: string; source: EditSource }) => {
      const current = live.current;
      if (current.scope !== request.scope || current.blocked) return;
      const draft = correctionDraft(request.source.text, {
        original: t('original'),
        replacement: t('replacement'),
        guidance: t('guidance'),
      });
      if (!current.replace(draft.text)) return;
      setNotice(request);
      setPending(null);
      setSelection({ ...draft, scope: request.scope });
    },
    [t]
  );
  const scope = options.scope;
  const start = useCallback(
    (source: EditSource) => {
      const current = live.current;
      if (
        !scope ||
        scope !== current.scope ||
        current.blocked ||
        !source.text.trim()
      )
        return;
      const request = { scope, source };
      if (current.value.trim() || current.hasDraftAttachments)
        setPending(request);
      else apply(request);
    },
    [scope, apply]
  );
  const onInputRef = useCallback((node: HTMLTextAreaElement | null) => {
    input.current = node;
  }, []);
  const controls = useMemo(
    () => ({ start, disabled: options.blocked }),
    [start, options.blocked]
  );
  return {
    controls,
    onInputRef,
    notice:
      notice && notice.scope === scope ? (
        <div
          role="status"
          className="flex items-start gap-3 px-4 pt-3 text-sm text-stone-600 dark:text-stone-300"
        >
          <p className="min-w-0 flex-1">
            {t('notice')}
            {notice.source.hasAttachments ? ` ${t('textOnly')}` : ''}
          </p>
          <button
            type="button"
            className="shrink-0 underline"
            onClick={() => setNotice(null)}
          >
            {t('exit')}
          </button>
        </div>
      ) : null,
    confirmation:
      pending && pending.scope === scope && !options.blocked ? (
        <ConfirmDialog
          isOpen
          onClose={() => setPending(null)}
          onConfirm={() => apply(pending)}
          title={t('replaceTitle')}
          message={t('replaceMessage')}
          confirmText={t('replaceConfirm')}
          icon="edit"
        />
      ) : null,
  };
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
