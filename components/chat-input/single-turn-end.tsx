'use client';

import { cn } from '@lib/utils';

import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { useTranslations } from 'next-intl';

import { ChatContainer } from './container';

export function SingleTurnEnd({
  href,
  widthClass,
  className,
  beforeInput,
  onHeightChange,
}: {
  href: string;
  widthClass: string;
  className?: string;
  beforeInput?: ReactNode;
  onHeightChange?: (height: number) => void;
}) {
  const t = useTranslations('pages.chatflow.composer');
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || !onHeightChange) return;
    const measure = () => onHeightChange(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <ChatContainer
      widthClass={widthClass}
      className={cn('w-[calc(100%-2rem)]', className)}
      beforeInput={beforeInput}
    >
      <div
        ref={content}
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
      >
        <p role="status" className="text-stone-500 dark:text-stone-400">
          {t('singleTurn')}
        </p>
        <a
          href={href}
          className="rounded-lg border border-stone-300 px-3 py-2 text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          {t('newTask')}
        </a>
      </div>
    </ChatContainer>
  );
}
