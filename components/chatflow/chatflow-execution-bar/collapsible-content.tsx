'use client';

import type { ReactNode } from 'react';

type CollapsibleContentProps = {
  isExpanded: boolean;
  show: boolean;
  children: ReactNode;
};

export function CollapsibleContent({
  isExpanded,
  show,
  children,
}: CollapsibleContentProps) {
  if (!show || !isExpanded) {
    return null;
  }

  return (
    <div className="animate-in slide-in-from-top-2 fade-in duration-250">
      {children}
    </div>
  );
}
