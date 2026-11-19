'use client';

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

  useEffect(() => () => controller.current?.abort(), [fingerprint]);

  const current = check?.fingerprint === fingerprint;
  const pending = current && check?.pending;
  const result = current ? check?.result : undefined;
  const ready =
    providerId &&
    (formData.apiKey.trim() || serviceInstanceId) &&
    (backend !== 'langchain' || formData.config.langchain?.assistant_id.trim());

  const diagnose = async () => {
    controller.current?.abort();
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
    }
  };

  return (
    <section
      className="rounded-lg border border-stone-200 p-4 dark:border-stone-600"
      aria-label={translate('title')}
    >
      <h4 className="font-serif text-sm font-semibold">{translate('title')}</h4>
      <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
        {translate('note')}
      </p>
      <button
        type="button"
        onClick={diagnose}
        disabled={disabled || !ready || Boolean(pending)}
        className="mt-3 rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-stone-500"
      >
        {pending ? translate('checking') : translate('check')}
      </button>
      <div role="status" aria-live="polite" className="mt-2 text-sm">
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
    </section>
  );
}
