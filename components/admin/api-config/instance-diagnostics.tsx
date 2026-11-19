'use client';

import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import type { AppDiagnosticResult } from '../../../packages/shared/src/app-diagnostics';
import type { InstanceFormData } from './instance-form-types';

interface Props {
  formData: InstanceFormData;
  providerId: string;
  serviceInstanceId?: string;
  disabled: boolean;
}

export function InstanceDiagnostics({
  formData,
  providerId,
  serviceInstanceId,
  disabled,
}: Props) {
  const translate = useTranslations('pages.admin.apiConfig.diagnostics');
  const backend = formData.config.backend_type || 'dify';
  const input = JSON.stringify({
    providerId,
    ...(serviceInstanceId ? { serviceInstanceId } : {}),
    backend,
    ...(formData.apiKey.trim() ? { apiKey: formData.apiKey.trim() } : {}),
    ...(backend === 'langchain'
      ? {
          assistantId: formData.config.langchain?.assistant_id.trim(),
          humanInput: formData.config.langchain?.human_input,
          resultProfileEnabled:
            formData.config.langchain?.result_profile_enabled,
        }
      : {}),
  });
  const fingerprint = JSON.stringify([
    input,
    formData.config.api_url,
    formData.config.app_metadata,
    formData.config.dify_parameters,
    formData.config.interaction_protocol,
  ]);
  const controller = useRef<AbortController | null>(null);
  const notification = useRef<string | number | undefined>(undefined);
  const [previousFingerprint, setPreviousFingerprint] = useState(fingerprint);
  const [check, setCheck] = useState<{
    fingerprint: string;
    pending: boolean;
    result?: AppDiagnosticResult;
  } | null>(null);

  if (previousFingerprint !== fingerprint) {
    setPreviousFingerprint(fingerprint);
    setCheck(previous =>
      previous ? { ...previous, fingerprint: '', pending: false } : null
    );
  }

  useEffect(
    () => () => {
      controller.current?.abort();
      if (notification.current !== undefined) {
        toast.dismiss(notification.current);
        notification.current = undefined;
      }
    },
    [fingerprint]
  );

  const current = check?.fingerprint === fingerprint;
  const pending = current && check?.pending;
  const result = current ? check?.result : undefined;
  const ready =
    providerId &&
    (formData.apiKey.trim() || serviceInstanceId) &&
    (backend !== 'langchain' || formData.config.langchain?.assistant_id.trim());

  const diagnose = async () => {
    controller.current?.abort();
    if (notification.current !== undefined) {
      toast.dismiss(notification.current);
      notification.current = undefined;
    }
    const request = new AbortController();
    controller.current = request;
    setCheck({ fingerprint, pending: true });
    let result: AppDiagnosticResult;
    try {
      const response = await fetch('/api/admin/app-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: input,
        signal: request.signal,
      });
      if (response.status === 400) {
        result = {
          status: 'error',
          code: 'invalidConfiguration',
          capabilities: [],
        };
      } else {
        if (!response.ok) throw new Error('Diagnostic request failed');
        result = await response.json();
      }
    } catch {
      result = { status: 'error', code: 'unavailable', capabilities: [] };
    }
    if (!request.signal.aborted && controller.current === request) {
      setCheck({ fingerprint, pending: false, result });
      const notify =
        result.status === 'success'
          ? toast.success
          : result.status === 'unsupported'
            ? toast.warning
            : toast.error;
      notification.current = notify(translate(`codes.${result.code}`), {
        description: [
          ...(result.status === 'success'
            ? result.capabilities.map(capability =>
                translate(`capabilities.${capability}`)
              )
            : []),
          ...(result.resultsPaused ? [translate('resultsPaused')] : []),
          translate('note'),
        ].join(' '),
        duration: 8000,
        closeButton: true,
      });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={diagnose}
        disabled={disabled || !ready || Boolean(pending)}
        title={translate('note')}
        className="flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 font-serif text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        )}
        {pending ? translate('checking') : translate('check')}
      </button>
      <div role="status" aria-live="polite" className="sr-only">
        {pending
          ? translate('checking')
          : result
            ? translate(`codes.${result.code}`)
            : check && !current
              ? translate('stale')
              : translate('unchecked')}
        {result?.status === 'success' && result.capabilities.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {result.capabilities.map(capability => (
              <li
                key={capability}
                className="rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-700"
              >
                {translate(`capabilities.${capability}`)}
              </li>
            ))}
          </ul>
        )}
        {result?.resultsPaused && (
          <p className="mt-2">{translate('resultsPaused')}</p>
        )}
      </div>
    </>
  );
}
