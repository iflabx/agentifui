import { cn } from '@lib/utils';
import { Loader2, RotateCcw, Send } from 'lucide-react';

interface ChatflowFormActionsProps {
  canSubmit: boolean;
  hasErrors: boolean;
  isPristine: boolean;
  isProcessing: boolean;
  isWaiting: boolean;
  onReset: () => void;
  resetLabel: string;
  submitLabel: string;
  validationHint: string;
  workingLabel: string;
}

export function ChatflowFormActions({
  canSubmit,
  hasErrors,
  isPristine,
  isProcessing,
  isWaiting,
  onReset,
  resetLabel,
  submitLabel,
  validationHint,
  workingLabel,
}: ChatflowFormActionsProps) {
  const disableReset = isProcessing || isWaiting || isPristine;

  return (
    <div
      className={cn(
        'border-t pt-6',
        'border-stone-200/50 dark:border-stone-700/50'
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={onReset}
          disabled={disableReset}
          className={cn(
            'flex items-center justify-center gap-3 rounded-xl px-6 py-3',
            'border-2 font-serif text-sm font-medium backdrop-blur-sm transition-all duration-300',
            'border-stone-300 bg-white/80 text-stone-700 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-300',
            disableReset
              ? 'cursor-not-allowed opacity-50'
              : cn(
                  'transform active:scale-[0.98]',
                  'hover:border-stone-400 hover:bg-stone-50 hover:shadow-lg hover:shadow-stone-200/50 dark:hover:border-stone-500 dark:hover:bg-stone-700 dark:hover:shadow-lg dark:hover:shadow-stone-900/50'
                )
          )}
        >
          <RotateCcw className="h-4 w-4" />
          {resetLabel}
        </button>

        <button
          type="submit"
          disabled={isProcessing || isWaiting || !canSubmit}
          className={cn(
            'flex flex-1 items-center justify-center gap-3 rounded-xl px-8 py-4',
            'font-serif text-base font-semibold text-white shadow-lg transition-all duration-300',
            'bg-gradient-to-r from-stone-800 to-stone-700 shadow-stone-800/25 dark:bg-gradient-to-r dark:from-stone-700 dark:to-stone-600 dark:shadow-stone-900/50',
            isProcessing || isWaiting || !canSubmit
              ? 'cursor-not-allowed opacity-50'
              : cn(
                  'transform hover:scale-[1.02] active:scale-[0.98]',
                  'hover:from-stone-700 hover:to-stone-600 hover:shadow-xl hover:shadow-stone-800/30 dark:hover:from-stone-600 dark:hover:to-stone-500 dark:hover:shadow-xl dark:hover:shadow-stone-900/60'
                )
          )}
        >
          {isProcessing || isWaiting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{workingLabel}</span>
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              <span>{submitLabel}</span>
            </>
          )}
        </button>
      </div>

      {hasErrors && (
        <div
          className={cn(
            'mt-6 rounded-xl border p-4 shadow-lg',
            'border-red-200 bg-gradient-to-r from-red-50 to-red-100/50 shadow-red-100/50 dark:border-red-700/50 dark:bg-gradient-to-r dark:from-red-900/20 dark:to-red-800/20 dark:shadow-red-900/20'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <p
              className={cn(
                'font-serif text-sm',
                'text-red-700 dark:text-red-300'
              )}
            >
              {validationHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
