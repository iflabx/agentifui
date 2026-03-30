import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { Separator } from '@components/ui/separator';
import type { SupportedLocale } from '@lib/config/language-config';
import { getLanguageInfo } from '@lib/config/language-config';
import { cn } from '@lib/utils';
import { Plus, Redo2, Undo2 } from 'lucide-react';

interface AboutEditorHeaderProps {
  canEditStructure: boolean;
  currentLocale: SupportedLocale;
  isDirty: boolean;
  onAddSection: () => void;
  onLocaleChange: (newLocale: SupportedLocale) => void;
  onRedo: () => void;
  onUndo: () => void;
  redoCount: number;
  sectionCount: number;
  supportedLocales: SupportedLocale[];
  t: (key: string) => string;
  undoCount: number;
}

export function AboutEditorHeader({
  canEditStructure,
  currentLocale,
  isDirty,
  onAddSection,
  onLocaleChange,
  onRedo,
  onUndo,
  redoCount,
  sectionCount,
  supportedLocales,
  t,
  undoCount,
}: AboutEditorHeaderProps) {
  return (
    <div
      className={cn(
        'border-b p-4',
        'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
      )}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">
            {t('common.editLanguage')}
          </label>
          <Select
            value={currentLocale}
            onValueChange={value => onLocaleChange(value as SupportedLocale)}
          >
            <SelectTrigger className="w-64">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-60">
                    {getLanguageInfo(currentLocale).code}
                  </span>
                  <span className="font-medium">
                    {getLanguageInfo(currentLocale).nativeName}
                  </span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {supportedLocales.map(locale => {
                const langInfo = getLanguageInfo(locale);
                return (
                  <SelectItem key={locale} value={locale}>
                    <div className="flex w-full items-center justify-between">
                      <span className="font-medium">{langInfo.nativeName}</span>
                      <span className="ml-2 text-xs opacity-60">
                        {langInfo.code}
                      </span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={undoCount === 0}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRedo}
              disabled={redoCount === 0}
            >
              <Redo2 className="mr-2 h-4 w-4" />
              Redo
            </Button>
            <Separator orientation="vertical" className="h-8" />
            <Button
              variant="outline"
              size="sm"
              onClick={onAddSection}
              disabled={!canEditStructure}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Section
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {isDirty && <Badge variant="secondary">Unsaved</Badge>}
            {!canEditStructure && <Badge variant="outline">Text Only</Badge>}
            <Badge variant="outline">{sectionCount} sections</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
