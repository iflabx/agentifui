'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

export function AppEntrySummary({
  description,
  config,
  difyAppType,
  compact,
}: {
  description?: string;
  config?: Record<string, unknown>;
  difyAppType?: string;
  compact: boolean;
}) {
  const translate = useTranslations('pages.apps.market.appCard');
  const [expanded, setExpanded] = useState(false);
  const langchain = config?.langchain as
    | {
        capabilities?: { text?: boolean };
      }
    | undefined;
  const metadata = config?.app_metadata as
    | {
        app_type?: string;
        dify_apptype?: string;
      }
    | undefined;
  const type = metadata?.dify_apptype || difyAppType;
  const textOnly =
    config?.backend_type !== 'langchain' &&
    config?.interaction_protocol === 'ag-ui/1.0' &&
    metadata?.app_type === 'marketplace' &&
    type === 'chatbot';
  const mode =
    config?.backend_type === 'langchain'
      ? langchain?.capabilities?.text === true
        ? 'text'
        : undefined
      : type === 'workflow'
        ? 'workflow'
        : type === 'text-generation'
          ? 'generation'
          : ['chatbot', 'chatflow', 'agent'].includes(type || '')
            ? 'conversation'
            : undefined;

  return (
    <div className="font-serif text-xs leading-relaxed text-stone-600 dark:text-stone-400">
      <p
        className={
          expanded
            ? 'relative z-10 cursor-text break-words whitespace-pre-wrap'
            : compact
              ? 'relative z-10 line-clamp-1 cursor-text'
              : 'relative z-10 line-clamp-2 cursor-text'
        }
      >
        {description || translate('noDescription')}
      </p>
      {description && (
        <button
          type="button"
          aria-expanded={expanded}
          className="relative z-10 mt-1 text-xs underline underline-offset-2"
          onClick={event => {
            event.stopPropagation();
            setExpanded(value => !value);
          }}
        >
          {expanded
            ? translate('lessDescription')
            : translate('moreDescription')}
        </button>
      )}
      {mode && (
        <p className="mt-2 text-xs font-medium">
          {translate(`entryModes.${mode}`)}
        </p>
      )}
      {textOnly && <p className="mt-1 text-xs">{translate('textOnlyLimit')}</p>}
    </div>
  );
}
