import { ArrayItemsField } from '@components/admin/content/context-menu/array-items-field';
import {
  SELECT_FIELD_OPTIONS,
  createDefaultCardItem,
  isValidCssDimension,
  removeListItem,
  shouldUseTextareaEditor,
  updateListItem,
} from '@components/admin/content/context-menu/helpers';
import { SecondaryButtonField } from '@components/admin/content/context-menu/secondary-button-field';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { Textarea } from '@components/ui/textarea';
import type { ComponentInstance } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { Upload } from 'lucide-react';

type PropertyFieldProps = {
  component: ComponentInstance;
  propertyKey: string;
  value: unknown;
  userId: string | null;
  onOpenUpload: () => void;
  onPropsChange: (newProps: Record<string, unknown>) => void;
};

export function PropertyField({
  component,
  propertyKey,
  value,
  userId,
  onOpenUpload,
  onPropsChange,
}: PropertyFieldProps) {
  const fieldId = `prop-${propertyKey}`;

  const handleInputChange = (name: string, nextValue: unknown) => {
    onPropsChange({ ...component.props, [name]: nextValue });
  };

  const handleSecondaryButtonChange = (key: string, nextValue: unknown) => {
    const currentSecondaryButton =
      (component.props.secondaryButton as Record<string, unknown>) || {};
    onPropsChange({
      ...component.props,
      secondaryButton: { ...currentSecondaryButton, [key]: nextValue },
    });
  };

  if (propertyKey === 'items' && component.type === 'cards') {
    const items = (value as Array<Record<string, unknown>>) || [];

    return (
      <ArrayItemsField
        fieldId={fieldId}
        label={propertyKey}
        items={items}
        onAddItem={() =>
          handleInputChange(propertyKey, [...items, createDefaultCardItem()])
        }
        onRemoveItem={index =>
          handleInputChange(propertyKey, removeListItem(items, index))
        }
        onItemChange={(index, key, nextValue) =>
          handleInputChange(
            propertyKey,
            updateListItem(items, index, key, nextValue)
          )
        }
      />
    );
  }

  if (propertyKey === 'secondaryButton' && component.type === 'button') {
    return (
      <SecondaryButtonField
        value={value as Record<string, unknown> | undefined}
        onAdd={() =>
          onPropsChange({
            ...component.props,
            secondaryButton: {
              text: 'Secondary Button',
              variant: 'outline',
              action: 'link',
              url: '#',
            },
          })
        }
        onChange={handleSecondaryButtonChange}
        onRemove={() => {
          const nextProps = { ...component.props };
          delete nextProps.secondaryButton;
          onPropsChange(nextProps);
        }}
      />
    );
  }

  if (SELECT_FIELD_OPTIONS[propertyKey]) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <Select
          value={String(value || '')}
          onValueChange={newValue =>
            handleInputChange(
              propertyKey,
              propertyKey === 'level' ? Number(newValue) : newValue
            )
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={`Select ${propertyKey}`} />
          </SelectTrigger>
          <SelectContent>
            {SELECT_FIELD_OPTIONS[propertyKey].map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (shouldUseTextareaEditor(component, propertyKey)) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <Textarea
          id={fieldId}
          value={String(value || '')}
          onChange={e => handleInputChange(propertyKey, e.target.value)}
          placeholder={`Enter ${propertyKey}`}
          className="min-h-[60px] text-sm"
        />
      </div>
    );
  }

  if (
    (propertyKey === 'width' || propertyKey === 'height') &&
    component.type === 'image'
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <Input
          id={fieldId}
          type="text"
          value={String(value || '')}
          onChange={e => {
            const inputValue = e.target.value;
            if (inputValue === '') {
              handleInputChange(propertyKey, '');
              return;
            }

            const trimmedValue = inputValue.trim();
            if (/^\d+(\.\d+)?$/.test(trimmedValue)) {
              handleInputChange(propertyKey, Number(trimmedValue));
              return;
            }

            handleInputChange(propertyKey, trimmedValue);
          }}
          onBlur={e => {
            const inputValue = e.target.value.trim();
            if (inputValue === '' || !isValidCssDimension(inputValue)) {
              handleInputChange(propertyKey, 'auto');
            }
          }}
          placeholder="e.g., 100, auto, 50%"
          className="h-8 text-sm"
        />
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Enter number (e.g., 100), auto, or CSS value (e.g., 50%, 100px)
        </p>
      </div>
    );
  }

  if (
    propertyKey === 'src' &&
    component.type === 'image' &&
    typeof value === 'string'
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <div className="flex gap-2">
          <Input
            id={fieldId}
            type="text"
            value={String(value || '')}
            onChange={e => handleInputChange(propertyKey, e.target.value)}
            placeholder="Enter image URL"
            className="h-8 flex-1 text-sm"
          />
          <button
            type="button"
            onClick={onOpenUpload}
            disabled={!userId}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
              'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            title="Upload local image"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload</span>
          </button>
        </div>
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <Input
          id={fieldId}
          type="number"
          value={String(value || '')}
          onChange={e =>
            handleInputChange(propertyKey, Number(e.target.value) || 0)
          }
          placeholder={`Enter ${propertyKey}`}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm capitalize">
          {propertyKey}
        </Label>
        <Input
          id={fieldId}
          type="text"
          value={String(value || '')}
          onChange={e => handleInputChange(propertyKey, e.target.value)}
          placeholder={`Enter ${propertyKey}`}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  return null;
}
