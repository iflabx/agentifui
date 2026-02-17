'use client';

import type {
  DifyFileInputControl,
  DifyNumberInputControl,
  DifyParagraphControl,
  DifySelectControl,
  DifyTextInputControl,
} from '@lib/services/dify/types';
import { cn } from '@lib/utils';

import React from 'react';

import { useTranslations } from 'next-intl';

import { CustomSelect } from './custom-select';
import { FileUploadField } from './file-upload-field';

// Union type for all possible form field values
type FormFieldValue = string | number | string[] | File[];

// Union type for all possible config types
type FormFieldConfig =
  | DifyTextInputControl
  | DifyNumberInputControl
  | DifyParagraphControl
  | DifySelectControl
  | DifyFileInputControl;

interface FormFieldProps {
  type: 'text-input' | 'number' | 'paragraph' | 'select' | 'file' | 'file-list';
  config: FormFieldConfig;
  value: FormFieldValue;
  onChange: (value: FormFieldValue) => void;
  error?: string;
  instanceId?: string; // Add instanceId for file upload
}

/**
 * Generic form field component
 *
 * Supported field types:
 * - text-input: Single line text input
 * - number: Number input
 * - paragraph: Multi-line text input
 * - select: Dropdown selection
 * - file: File upload
 */
export function FormField({
  type,
  config,
  value,
  onChange,
  error,
  instanceId,
}: FormFieldProps) {
  const t = useTranslations('pages.workflow.form');

  const baseInputClasses = cn(
    'w-full rounded-xl border-2 px-4 py-3 font-serif transition-all duration-300',
    'focus:border-stone-500 focus:ring-4 focus:ring-stone-500/20 focus:outline-none',
    'backdrop-blur-sm focus:shadow-lg focus:shadow-stone-500/25',
    error
      ? 'border-red-400 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20 dark:bg-red-900/10'
      : 'border-stone-300 bg-white/90 text-stone-900 placeholder-stone-500 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-800/90 dark:text-stone-100 dark:placeholder-stone-400 dark:hover:border-stone-500'
  );

  const labelClasses = cn(
    'mb-3 flex items-center gap-2 font-serif text-sm font-semibold',
    'text-stone-800 dark:text-stone-200'
  );

  const errorClasses = cn(
    'mt-2 flex items-center gap-2',
    'text-red-600 dark:text-red-400'
  );

  const renderInput = () => {
    switch (type) {
      case 'text-input':
        const textConfig = config as DifyTextInputControl;
        return (
          <input
            type="text"
            value={value as string}
            onChange={e => onChange(e.target.value)}
            placeholder={t('inputPlaceholder', { label: config.label })}
            maxLength={textConfig.max_length || undefined}
            className={baseInputClasses}
          />
        );

      case 'number':
        const numberConfig = config as DifyNumberInputControl;
        return (
          <input
            type="number"
            value={value as string | number}
            onChange={e => {
              const inputValue = e.target.value;

              // If the input is empty, pass an empty string
              if (inputValue === '') {
                onChange('');
                return;
              }

              // Try to convert to a number
              const numValue = parseFloat(inputValue);

              if (!isNaN(numValue)) {
                onChange(numValue);
              } else {
                // If conversion fails, keep the original string (for validation)
                onChange(inputValue);
              }
            }}
            placeholder={t('inputPlaceholder', { label: config.label })}
            min={numberConfig.min}
            max={numberConfig.max}
            step={numberConfig.step || 1}
            className={baseInputClasses}
          />
        );

      case 'paragraph':
        const paragraphConfig = config as DifyParagraphControl;
        const hasMaxLength = (
          paragraphConfig as DifyParagraphControl & { max_length?: number }
        ).max_length;
        return (
          <textarea
            value={value as string}
            onChange={e => onChange(e.target.value)}
            placeholder={t('inputPlaceholder', { label: config.label })}
            rows={6}
            maxLength={hasMaxLength || undefined}
            className={cn(
              baseInputClasses,
              'resize-none',
              hasMaxLength ? 'pb-8' : '' // Leave space for character counter
            )}
          />
        );

      case 'select':
        const selectConfig = config as DifySelectControl;
        return (
          <CustomSelect
            value={value as string}
            onChange={onChange}
            options={selectConfig.options}
            placeholder={t('selectPlaceholder', { label: config.label })}
            error={error}
          />
        );

      case 'file':
        const fileConfig = config as DifyFileInputControl;
        if (!instanceId) {
          console.warn(
            '[FormField] file type field requires instanceId parameter'
          );
          return null;
        }
        return (
          <FileUploadField
            config={{
              ...fileConfig, // Keep all original fields
              enabled: true, // Ensure enabled
            }}
            value={value || []}
            onChange={nextValue => onChange(nextValue as FormFieldValue)}
            error={error}
            instanceId={instanceId}
            isSingleFileMode={true} // Single file mode
          />
        );

      case 'file-list':
        const fileListConfig = config as DifyFileInputControl;
        if (!instanceId) {
          console.warn(
            '[FormField] file-list type field requires instanceId parameter'
          );
          return null;
        }
        return (
          <FileUploadField
            config={{
              ...fileListConfig, // Keep all original fields
              enabled: true, // Ensure enabled
            }}
            value={value || []}
            onChange={nextValue => onChange(nextValue as FormFieldValue)}
            error={error}
            instanceId={instanceId}
            isSingleFileMode={false} // Multiple file mode
          />
        );

      default:
        return null;
    }
  };

  // Generate range hint information for number type
  const getNumberHint = () => {
    if (type !== 'number') return null;

    const numberConfig = config as DifyNumberInputControl;
    const hints: string[] = [];

    if (numberConfig.min !== undefined && numberConfig.max !== undefined) {
      hints.push(
        t('rangeHint', { min: numberConfig.min, max: numberConfig.max })
      );
    } else if (numberConfig.min !== undefined) {
      hints.push(t('minValueHint', { min: numberConfig.min }));
    } else if (numberConfig.max !== undefined) {
      hints.push(t('maxValueHint', { max: numberConfig.max }));
    }

    if (numberConfig.step && numberConfig.step !== 1) {
      hints.push(t('stepHint', { step: numberConfig.step }));
    }

    if (numberConfig.precision !== undefined) {
      hints.push(t('precisionHint', { precision: numberConfig.precision }));
    }

    return hints.length > 0 ? hints.join('，') : null;
  };

  return (
    <div className="space-y-1">
      <label className={labelClasses}>
        <div
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            'bg-gradient-to-r from-stone-500 to-stone-400'
          )}
        />
        {config.label}
        {config.required && <span className="ml-1 text-red-500">*</span>}
      </label>

      <div className="relative">
        {renderInput()}

        {/* Character count (only display for fields with length limit) */}
        {(type === 'text-input' || type === 'paragraph') &&
          (
            config as DifyTextInputControl &
              DifyParagraphControl & { max_length?: number }
          ).max_length && (
            <div
              className={cn(
                'absolute right-4 bottom-3 font-mono text-xs transition-opacity duration-200',
                'text-stone-400 dark:text-stone-500',
                ((value as string) || '').length > 0
                  ? 'opacity-100'
                  : 'opacity-0'
              )}
            >
              {((value as string) || '').length} /{' '}
              {
                (
                  config as DifyTextInputControl &
                    DifyParagraphControl & { max_length?: number }
                ).max_length
              }
            </div>
          )}
      </div>

      {/* Range hint for number type */}
      {type === 'number' && getNumberHint() && (
        <div
          className={cn(
            'font-serif text-xs',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {getNumberHint()}
        </div>
      )}

      {/* Error hint */}
      {error && (
        <div className={errorClasses}>
          <div className="h-1 w-1 rounded-full bg-red-500" />
          <span className="font-serif text-sm">{error}</span>
        </div>
      )}
    </div>
  );
}
