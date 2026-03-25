import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { cn } from '@lib/utils';
import { Plus, Trash2 } from 'lucide-react';

type SecondaryButtonFieldProps = {
  value?: Record<string, unknown>;
  onAdd: () => void;
  onChange: (key: string, value: unknown) => void;
  onRemove: () => void;
};

export function SecondaryButtonField({
  value,
  onAdd,
  onChange,
  onRemove,
}: SecondaryButtonFieldProps) {
  if (!value) {
    return (
      <div className="space-y-2">
        <Label className="text-sm">Secondary Button</Label>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
            'border-stone-300 bg-white text-stone-900 hover:bg-stone-50',
            'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700'
          )}
        >
          <Plus className="h-3 w-3" />
          Add Second Button
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Secondary Button</Label>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div
        className={cn(
          'space-y-3 rounded-lg border p-3',
          'border-stone-200 bg-stone-50 dark:border-stone-600 dark:bg-stone-700'
        )}
      >
        <div className="space-y-2">
          <Label className="text-xs">Text</Label>
          <Input
            type="text"
            value={String(value.text || '')}
            onChange={e => onChange('text', e.target.value)}
            placeholder="Enter button text"
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Variant</Label>
          <Select
            value={String(value.variant || 'outline')}
            onValueChange={newValue => onChange('variant', newValue)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select variant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="solid">Solid</SelectItem>
              <SelectItem value="outline">Outline</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Action</Label>
          <Select
            value={String(value.action || 'link')}
            onValueChange={newValue => onChange('action', newValue)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link">Link</SelectItem>
              <SelectItem value="submit">Submit</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">URL</Label>
          <Input
            type="text"
            value={String(value.url || '')}
            onChange={e => onChange('url', e.target.value)}
            placeholder="Enter URL"
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
