'use client';

import type { ReactNode } from 'react';

function SourceTitle({
  title,
  as: Title = 'p',
  className,
}: {
  title: string;
  as?: 'p' | 'h4';
  className?: string;
}) {
  return <Title className={className}>{title}</Title>;
}

function SourceExcerpt({
  excerpt,
  className,
}: {
  excerpt: string;
  className?: string;
}) {
  return <p className={className}>{excerpt}</p>;
}

function SourceCopyButton({
  onCopy,
  label,
  icon,
  className,
  'aria-label': ariaLabel,
}: {
  onCopy: () => void;
  label: string;
  icon?: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      onClick={onCopy}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function SourceListItem({
  title,
  excerpt,
  onCopy,
  copyLabel,
  copyIcon,
  copyAriaLabel,
  className,
  titleAs,
  titleClassName,
  excerptClassName,
  copyClassName,
  renderHeader = content => content,
  renderExcerpt = content => content,
  renderActions = content => content,
}: {
  title: string;
  excerpt: string;
  onCopy: () => void;
  copyLabel: string;
  copyIcon?: ReactNode;
  copyAriaLabel?: string;
  className?: string;
  titleAs?: 'p' | 'h4';
  titleClassName?: string;
  excerptClassName?: string;
  copyClassName?: string;
  renderHeader?: (title: ReactNode) => ReactNode;
  renderExcerpt?: (excerpt: ReactNode) => ReactNode;
  renderActions?: (copyButton: ReactNode) => ReactNode;
}) {
  return (
    <div className={className}>
      {renderHeader(
        <SourceTitle title={title} as={titleAs} className={titleClassName} />
      )}
      {renderExcerpt(
        <SourceExcerpt excerpt={excerpt} className={excerptClassName} />
      )}
      {renderActions(
        <SourceCopyButton
          onCopy={onCopy}
          label={copyLabel}
          icon={copyIcon}
          aria-label={copyAriaLabel}
          className={copyClassName}
        />
      )}
    </div>
  );
}
