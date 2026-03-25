import { cn } from '@lib/utils';
import { Loader2 } from 'lucide-react';

interface ChatflowInputLoadingStateProps {
  loadingText: string;
  paddingClass: string;
  widthClass: string;
}

export function ChatflowInputLoadingState({
  loadingText,
  paddingClass,
  widthClass,
}: ChatflowInputLoadingStateProps) {
  return (
    <div className={cn('mx-auto w-full', widthClass, paddingClass, 'py-8')}>
      <div className="flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Loader2
            className={cn(
              'mx-auto h-6 w-6 animate-spin',
              'text-stone-500 dark:text-stone-400'
            )}
          />
          <p
            className={cn(
              'font-serif text-sm',
              'text-stone-500 dark:text-stone-400'
            )}
          >
            {loadingText}
          </p>
        </div>
      </div>
    </div>
  );
}
