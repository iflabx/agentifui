'use client';

import { DropdownMenuV2 } from '@components/ui/dropdown-menu-v2';
import { MoreButtonV2 } from '@components/ui/more-button-v2';

import { useCallback, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

export function TaskActions({
  disabled,
  onReuse,
}: {
  disabled: boolean;
  onReuse: () => void;
}) {
  const t = useTranslations('taskChat');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusMenu = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);
  return (
    <div
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <DropdownMenuV2
        isOpen={open}
        onOpenChange={setOpen}
        preventScroll={false}
        trigger={
          <MoreButtonV2
            ref={trigger}
            type="button"
            forceVisible
            isMenuOpen={open}
            aria-expanded={open}
            disabled={disabled}
          />
        }
      >
        <div ref={focusMenu}>
          <DropdownMenuV2.Item
            disabled={disabled}
            onClick={() => {
              onReuse();
              trigger.current?.focus();
            }}
          >
            {t('runAgain')}
          </DropdownMenuV2.Item>
        </div>
      </DropdownMenuV2>
    </div>
  );
}
