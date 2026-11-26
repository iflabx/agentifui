import { useChatWidth } from '@lib/hooks/use-chat-width';
import { cn } from '@lib/utils';

import type { ReactNode } from 'react';

export function ChatSessionHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const { widthClass, paddingClass } = useChatWidth();
  return (
    <header
      className={cn(
        'mx-auto flex w-full shrink-0 items-center justify-between gap-3 py-3',
        widthClass,
        paddingClass
      )}
    >
      <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
      {children}
    </header>
  );
}
