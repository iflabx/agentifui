import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import { Textarea } from '@components/ui/textarea';
import { cn } from '@lib/utils';
import { Plus, Trash2 } from 'lucide-react';

type ArrayItemsFieldProps = {
  fieldId: string;
  label: string;
  items: Array<Record<string, unknown>>;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onItemChange: (index: number, key: string, value: unknown) => void;
};

export function ArrayItemsField({
  fieldId,
  label,
  items,
  onAddItem,
  onRemoveItem,
  onItemChange,
}: ArrayItemsFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId} className="capitalize">
        {label}
      </Label>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {items.map((item, index) => (
          <div
            key={index}
            className={cn(
              'rounded-lg border p-3',
              'border-stone-200 bg-stone-50 dark:border-stone-600 dark:bg-stone-700'
            )}
          >
            <div className="flex items-center justify-between pb-2">
              <h5 className="text-xs font-medium text-stone-600 dark:text-stone-400">
                Item {index + 1}
              </h5>
              <button
                type="button"
                onClick={() => onRemoveItem(index)}
                className="flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(item).map(([itemKey, itemValue]) => {
                const isSingleLine =
                  typeof itemValue === 'string' &&
                  String(itemValue).length < 80;

                return (
                  <div key={itemKey}>
                    <Label className="text-xs capitalize">{itemKey}</Label>
                    {isSingleLine ? (
                      <Input
                        value={String(itemValue || '')}
                        onChange={e =>
                          onItemChange(index, itemKey, e.target.value)
                        }
                        className="h-8 text-xs"
                        placeholder={`Enter ${itemKey}`}
                      />
                    ) : (
                      <Textarea
                        value={String(itemValue || '')}
                        onChange={e =>
                          onItemChange(index, itemKey, e.target.value)
                        }
                        className="min-h-[40px] text-xs"
                        placeholder={`Enter ${itemKey}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={onAddItem}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
            'border-stone-300 bg-white text-stone-900 hover:bg-stone-50',
            'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700'
          )}
        >
          <Plus className="h-3 w-3" />
          Add Item
        </button>
      </div>
    </div>
  );
}
