'use client';

import { ImageUploadDialog } from '@components/admin/content/image-upload-dialog';
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
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import { ComponentInstance } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { Plus, Trash2, Upload, X } from 'lucide-react';

import React, { useEffect, useRef, useState } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  component: ComponentInstance | null;
  onPropsChange: (newProps: Record<string, unknown>) => void;
  onDelete: (componentId: string) => void;
  onClose: () => void;
}

/**
 * Context Menu Component
 *
 * Right-click context menu that directly shows property editor
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  component,
  onPropsChange,
  onDelete,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (modalRef.current) {
      const modal = modalRef.current;
      const rect = modal.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      // Adjust position if modal would go outside viewport
      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 20;
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 20;
      }
      if (newX < 20) newX = 20;
      if (newY < 20) newY = 20;

      setPosition({ x: newX, y: newY });
    }
  }, [x, y]);

  // Handle ESC key press to close the context menu
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  // Fetch current user ID on mount
  useEffect(() => {
    let isMounted = true;

    const fetchUserId = async () => {
      const user = await getCurrentUser();
      if (isMounted && user) {
        setUserId(user.id);
      }
    };

    fetchUserId();

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Validate if a value is a valid CSS dimension
   *
   * Accepts: numbers, 'auto', percentages (e.g., '50%'), and CSS units (e.g., '100px')
   */
  const isValidCssDimension = (value: string | number): boolean => {
    if (typeof value === 'number') return true;
    if (typeof value !== 'string') return false;

    // Match: numbers (integers or floats, pure or with units), percentages, or 'auto'
    return /^(\d+(\.\d+)?(px|em|rem|%|vh|vw)?|auto)$/.test(value.trim());
  };

  const handleInputChange = (name: string, value: unknown) => {
    if (!component) return;
    onPropsChange({ ...component.props, [name]: value });
  };

  const handleSecondaryButtonChange = (key: string, value: unknown) => {
    if (!component) return;
    const currentSecondaryButton =
      (component.props.secondaryButton as Record<string, unknown>) || {};
    const updatedSecondaryButton = { ...currentSecondaryButton, [key]: value };
    onPropsChange({
      ...component.props,
      secondaryButton: updatedSecondaryButton,
    });
  };

  const handleAddSecondaryButton = () => {
    if (!component) return;
    const defaultSecondaryButton = {
      text: 'Secondary Button',
      variant: 'outline',
      action: 'link',
      url: '#',
    };
    onPropsChange({
      ...component.props,
      secondaryButton: defaultSecondaryButton,
    });
  };

  const handleRemoveSecondaryButton = () => {
    if (!component) return;
    const newProps = { ...component.props };
    delete newProps.secondaryButton;
    onPropsChange(newProps);
  };

  const handleItemsChange = (newItems: Array<Record<string, unknown>>) => {
    handleInputChange('items', newItems);
  };

  const handleItemChange = (index: number, key: string, value: unknown) => {
    if (!component) return;
    const items = component.props.items as Array<Record<string, unknown>>;
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [key]: value };
    handleItemsChange(newItems);
  };

  const handleAddItem = () => {
    if (!component) return;
    const items =
      (component.props.items as Array<Record<string, unknown>>) || [];
    const newItem = {
      title: 'New Item',
      description: 'Add description here',
    };
    handleItemsChange([...items, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    if (!component) return;
    const items = component.props.items as Array<Record<string, unknown>>;
    const newItems = items.filter((_, i) => i !== index);
    handleItemsChange(newItems);
  };

  const handleDelete = () => {
    if (component) {
      onDelete(component.id);
      onClose();
    }
  };

  if (!component) return null;

  const renderPropertyField = (key: string, value: unknown) => {
    const fieldId = `prop-${key}`;

    // Array properties (cards items)
    if (key === 'items' && component.type === 'cards') {
      const items = value as Array<Record<string, unknown>>;
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="capitalize">
            {key}
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
                    onClick={() => handleRemoveItem(index)}
                    className="flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="space-y-2">
                  {Object.entries(item).map(([itemKey, itemValue]) => (
                    <div key={itemKey}>
                      <Label className="text-xs capitalize">{itemKey}</Label>
                      <Textarea
                        value={String(itemValue || '')}
                        onChange={e =>
                          handleItemChange(index, itemKey, e.target.value)
                        }
                        className="min-h-[40px] text-xs"
                        placeholder={`Enter ${itemKey}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddItem}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                'border-stone-300 bg-white text-stone-900 hover:bg-stone-50',
                'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
                'flex items-center justify-center gap-2'
              )}
            >
              <Plus className="h-3 w-3" />
              Add Item
            </button>
          </div>
        </div>
      );
    }

    // Secondary button for button component
    if (key === 'secondaryButton' && component.type === 'button') {
      const secondaryButton = value as Record<string, unknown> | undefined;

      if (!secondaryButton) {
        return (
          <div key={key} className="space-y-2">
            <Label className="text-sm">Secondary Button</Label>
            <button
              type="button"
              onClick={handleAddSecondaryButton}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                'border-stone-300 bg-white text-stone-900 hover:bg-stone-50',
                'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
                'flex items-center justify-center gap-2'
              )}
            >
              <Plus className="h-3 w-3" />
              Add Second Button
            </button>
          </div>
        );
      }

      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Secondary Button</Label>
            <button
              type="button"
              onClick={handleRemoveSecondaryButton}
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
            {/* Text field */}
            <div className="space-y-2">
              <Label className="text-xs">Text</Label>
              <Input
                type="text"
                value={String(secondaryButton.text || '')}
                onChange={e =>
                  handleSecondaryButtonChange('text', e.target.value)
                }
                placeholder="Enter button text"
                className="h-8 text-sm"
              />
            </div>

            {/* Variant field */}
            <div className="space-y-2">
              <Label className="text-xs">Variant</Label>
              <Select
                value={String(secondaryButton.variant || 'outline')}
                onValueChange={newValue =>
                  handleSecondaryButtonChange('variant', newValue)
                }
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

            {/* Action field */}
            <div className="space-y-2">
              <Label className="text-xs">Action</Label>
              <Select
                value={String(secondaryButton.action || 'link')}
                onValueChange={newValue =>
                  handleSecondaryButtonChange('action', newValue)
                }
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

            {/* URL field */}
            <div className="space-y-2">
              <Label className="text-xs">URL</Label>
              <Input
                type="text"
                value={String(secondaryButton.url || '')}
                onChange={e =>
                  handleSecondaryButtonChange('url', e.target.value)
                }
                placeholder="Enter URL"
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>
      );
    }

    // Select fields
    const selectFields: Record<
      string,
      Array<{ value: string; label: string }>
    > = {
      layout: [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List' },
      ],
      thickness: [
        { value: 'thin', label: 'Thin' },
        { value: 'medium', label: 'Medium' },
        { value: 'thick', label: 'Thick' },
      ],
      style: [
        { value: 'solid', label: 'Solid' },
        { value: 'dashed', label: 'Dashed' },
        { value: 'dotted', label: 'Dotted' },
      ],
      alignment: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
      textAlign: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
      action: [
        { value: 'link', label: 'Link' },
        { value: 'submit', label: 'Submit' },
        { value: 'external', label: 'External' },
      ],
      variant: [
        { value: 'solid', label: 'Solid' },
        { value: 'outline', label: 'Outline' },
      ],
      level: [
        { value: '1', label: 'H1' },
        { value: '2', label: 'H2' },
        { value: '3', label: 'H3' },
        { value: '4', label: 'H4' },
        { value: '5', label: 'H5' },
        { value: '6', label: 'H6' },
      ],
    };

    if (selectFields[key]) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <Select
            value={String(value || '')}
            onValueChange={newValue =>
              handleInputChange(
                key,
                key === 'level' ? Number(newValue) : newValue
              )
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={`Select ${key}`} />
            </SelectTrigger>
            <SelectContent>
              {selectFields[key].map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    // Multi-line text fields
    if (
      key === 'content' &&
      (component.type === 'paragraph' || component.type === 'heading')
    ) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <Textarea
            id={fieldId}
            value={String(value || '')}
            onChange={e => handleInputChange(key, e.target.value)}
            placeholder={`Enter ${key}`}
            className="min-h-[60px] text-sm"
          />
        </div>
      );
    }

    // Smart dimension fields (width/height for image component)
    if ((key === 'width' || key === 'height') && component.type === 'image') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <Input
            id={fieldId}
            type="text"
            value={String(value || '')}
            onChange={e => {
              const inputValue = e.target.value;

              // Allow empty value during editing (don't auto-fill immediately)
              if (inputValue === '') {
                handleInputChange(key, '');
                return;
              }

              const trimmedValue = inputValue.trim();

              // Convert pure numeric strings (integers or floats) to numbers for proper rendering
              if (/^\d+(\.\d+)?$/.test(trimmedValue)) {
                handleInputChange(key, Number(trimmedValue));
              } else {
                // Keep CSS values as strings (auto, 100%, 100px, etc.)
                // Allow any input during typing, validation happens on blur
                handleInputChange(key, trimmedValue);
              }
            }}
            onBlur={e => {
              const inputValue = e.target.value.trim();

              // If empty or invalid, default to 'auto'
              if (inputValue === '' || !isValidCssDimension(inputValue)) {
                handleInputChange(key, 'auto');
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

    // Number fields
    if (typeof value === 'number') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <Input
            id={fieldId}
            type="number"
            value={String(value || '')}
            onChange={e => handleInputChange(key, Number(e.target.value) || 0)}
            placeholder={`Enter ${key}`}
            className="h-8 text-sm"
          />
        </div>
      );
    }

    // Special handling for src field in image component
    if (
      key === 'src' &&
      component.type === 'image' &&
      typeof value === 'string'
    ) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <div className="flex gap-2">
            <Input
              id={fieldId}
              type="text"
              value={String(value || '')}
              onChange={e => handleInputChange(key, e.target.value)}
              placeholder="Enter image URL"
              className="h-8 flex-1 text-sm"
            />
            <button
              type="button"
              onClick={() => setIsUploadDialogOpen(true)}
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

    // String fields
    if (typeof value === 'string') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={fieldId} className="text-sm capitalize">
            {key}
          </Label>
          <Input
            id={fieldId}
            type="text"
            value={String(value || '')}
            onChange={e => handleInputChange(key, e.target.value)}
            placeholder={`Enter ${key}`}
            className="h-8 text-sm"
          />
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Property Editor Modal */}
      <div
        ref={modalRef}
        className={cn(
          'fixed z-50 max-h-96 w-80 overflow-y-auto',
          'rounded-lg border shadow-lg',
          'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
        )}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <div className="border-b border-stone-200 p-3 dark:border-stone-700">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-stone-900 capitalize dark:text-stone-100">
              {component.type} Properties
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
                title="Delete Component"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded p-0 text-stone-500 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700"
                title="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-3">
          {Object.entries(component.props).map(([key, value]) =>
            renderPropertyField(key, value)
          )}
          {/* Always show secondary button option for button components */}
          {component.type === 'button' &&
            !component.props.secondaryButton &&
            renderPropertyField('secondaryButton', undefined)}
        </div>
      </div>

      {/* Image Upload Dialog */}
      {userId && (
        <ImageUploadDialog
          isOpen={isUploadDialogOpen}
          onClose={() => setIsUploadDialogOpen(false)}
          onUploadSuccess={(url, path) => {
            // Auto-fill the uploaded image URL and save path in one update
            if (!component) return;
            onPropsChange({
              ...component.props,
              src: url,
              _imagePath: path,
            });
          }}
          userId={userId}
        />
      )}
    </>
  );
};
