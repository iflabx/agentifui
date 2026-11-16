'use client';

import { useMobile } from '@lib/hooks/use-mobile';
import { AnimatePresence, motion } from 'framer-motion';
import { XIcon } from 'lucide-react';

import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

import { useTranslations } from 'next-intl';

import * as Dialog from '@radix-ui/react-dialog';

export function PreviewShell({
  open,
  title,
  onClose,
  returnFocusRef,
  onReturn,
  returnLabel,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onReturn?: () => void;
  returnLabel?: string;
  children: ReactNode;
}) {
  const t = useTranslations('filePreview');
  const isMobile = useMobile();
  const previousFocus = useRef<HTMLElement | null>(null);
  const isOpen = useRef(open);
  const focusTarget = returnFocusRef ?? previousFocus;
  useEffect(() => {
    isOpen.current = open;
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      modal={isMobile}
      onOpenChange={value => !value && onClose()}
    >
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && isMobile && (
            <Dialog.Overlay key="backdrop" forceMount asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              />
            </Dialog.Overlay>
          )}
          {open && (
            <Dialog.Content
              key="panel"
              forceMount
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={() => {
                if (
                  !returnFocusRef &&
                  !previousFocus.current?.isConnected &&
                  document.activeElement instanceof HTMLElement
                )
                  previousFocus.current = document.activeElement;
              }}
              onCloseAutoFocus={event => {
                event.preventDefault();
                if (isOpen.current) return;
                if (focusTarget.current?.isConnected)
                  focusTarget.current.focus({ preventScroll: true });
                previousFocus.current = null;
              }}
              onInteractOutside={event => {
                if (!isMobile) event.preventDefault();
              }}
            >
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'tween', duration: 0.2, ease: 'easeInOut' }}
                className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-stone-200 bg-white text-stone-900 shadow-xl md:w-[60%] lg:w-[50%] xl:w-[40%] dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 p-4 dark:border-stone-700">
                  <Dialog.Title
                    className="min-w-0 truncate text-xl font-semibold"
                    title={title}
                  >
                    {title}
                  </Dialog.Title>
                  <Dialog.Close
                    className="shrink-0 rounded-full p-1 hover:bg-stone-200 dark:hover:bg-stone-700"
                    aria-label={t('closeButton')}
                  >
                    <XIcon className="h-5 w-5" />
                  </Dialog.Close>
                </div>
                {onReturn && (
                  <button
                    type="button"
                    className="self-start px-4 py-2 text-sm underline"
                    onClick={onReturn}
                  >
                    {returnLabel}
                  </button>
                )}
                <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
                  {children}
                </div>
              </motion.div>
            </Dialog.Content>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
