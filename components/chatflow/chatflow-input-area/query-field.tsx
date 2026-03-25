import { cn } from '@lib/utils';

import type { ChangeEvent, KeyboardEventHandler } from 'react';

interface ChatflowQueryFieldProps {
  disabled: boolean;
  error?: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd: () => void;
  onCompositionStart: () => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder: string;
  query: string;
  requiredLabel: string;
}

export function ChatflowQueryField({
  disabled,
  error,
  onChange,
  onCompositionEnd,
  onCompositionStart,
  onKeyDown,
  placeholder,
  query,
  requiredLabel,
}: ChatflowQueryFieldProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            'bg-gradient-to-r from-stone-500 to-stone-400'
          )}
        />
        <label
          className={cn(
            'font-serif text-base font-semibold',
            'text-stone-800 dark:text-stone-200'
          )}
        >
          {requiredLabel} <span className="ml-1 text-red-500">*</span>
        </label>
      </div>

      <div className="group relative">
        <textarea
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
          rows={4}
          className={cn(
            'w-full resize-none rounded-xl border-2 px-5 py-4 font-serif',
            'backdrop-blur-sm transition-all duration-300',
            'focus:border-stone-500 focus:ring-4 focus:ring-stone-500/20 focus:outline-none',
            'focus:shadow-lg focus:shadow-stone-500/25',
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
              : 'border-stone-300 bg-white/80 text-stone-900 group-hover:border-stone-400 placeholder:text-stone-500 focus:bg-white dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-100 dark:group-hover:border-stone-500 dark:placeholder:text-stone-400 dark:focus:bg-stone-800'
          )}
          disabled={disabled}
        />

        {error && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2',
              'text-red-600 dark:text-red-400'
            )}
          >
            <div className="h-1 w-1 rounded-full bg-red-500" />
            <p className="font-serif text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
