'use client';

import type { AgentInteraction } from '@lib/services/client/langchain-api';

import { useEffect, useId, useState } from 'react';

import { useTranslations } from 'next-intl';

export function AgentInteractionCard({
  interaction,
  disabled,
  uncertain,
  onRespond,
}: {
  interaction: AgentInteraction;
  disabled: boolean;
  uncertain: boolean;
  onRespond: (
    id: string,
    action: 'approve' | 'reject',
    comment: string
  ) => Promise<unknown>;
}) {
  const t = useTranslations('langchain');
  const commentId = useId();
  const [comment, setComment] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (interaction.expiresAt === null) return;
    const expiration = Date.parse(interaction.expiresAt);
    if (!Number.isFinite(expiration) || expiration <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, expiration - Date.now()), 2147483647)
    );
    return () => clearTimeout(timer);
  }, [interaction.expiresAt, now]);
  const expired =
    interaction.status === 'expired' ||
    (interaction.status === 'pending' &&
      interaction.expiresAt !== null &&
      (!Number.isFinite(Date.parse(interaction.expiresAt)) ||
        Date.parse(interaction.expiresAt) <= now));
  const pending = interaction.status === 'pending' && !expired && !uncertain;
  return (
    <section
      aria-label={t('confirmationTitle')}
      className="my-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm dark:border-stone-700 dark:bg-stone-900"
    >
      <h2 className="font-medium">{interaction.title}</h2>
      <p className="mt-2 whitespace-pre-wrap">{interaction.description}</p>
      <p role="status" className="mt-2 text-stone-500">
        {t(
          uncertain || interaction.status === 'unknown'
            ? 'confirmationUnknown'
            : expired
              ? 'confirmationExpired'
              : interaction.status === 'accepted'
                ? 'confirmationAnswered'
                : interaction.status === 'submitting'
                  ? 'confirmationSubmitting'
                  : 'confirmationWaiting'
        )}
      </p>
      {interaction.decision && (
        <p className="mt-2 whitespace-pre-wrap">
          {t(
            interaction.decision.action === 'approve'
              ? 'confirmationApprove'
              : 'confirmationReject'
          )}
          {interaction.decision.comment && `: ${interaction.decision.comment}`}
        </p>
      )}
      {pending && (
        <form
          className="mt-3 space-y-3"
          onSubmit={event => event.preventDefault()}
        >
          <label htmlFor={commentId} className="block">
            {t('confirmationComment')}
          </label>
          <textarea
            id={commentId}
            name="interaction-comment"
            value={comment}
            onChange={event => setComment(event.target.value)}
            maxLength={interaction.commentMaxLength}
            disabled={disabled}
            rows={2}
            className="w-full rounded-lg border border-stone-300 bg-white p-2 dark:border-stone-600 dark:bg-stone-950"
          />
          <div className="flex gap-3">
            {interaction.actions.map(action => (
              <button
                key={action}
                type="button"
                disabled={disabled}
                onClick={() => void onRespond(interaction.id, action, comment)}
                className="rounded-lg border border-stone-300 px-4 py-2 disabled:opacity-50 dark:border-stone-600"
              >
                {t(
                  action === 'approve'
                    ? 'confirmationApprove'
                    : 'confirmationReject'
                )}
              </button>
            ))}
          </div>
        </form>
      )}
    </section>
  );
}
