import type {
  DifyNumberInputControl,
  DifySelectControl,
  DifyTextInputControl,
  DifyUserInputFormItem,
} from '@lib/services/dify/types';
import {
  filterVisibleUserInputForm,
  getDifyUserInputFormEntry,
} from '@lib/services/dify/user-input-form';

import {
  type AgentInputCapabilities,
  validateInputFile,
  validateInputFileCount,
} from '../../../packages/shared/src/agent-input';

export function capabilityFormFields(
  capabilities: AgentInputCapabilities | null
): DifyUserInputFormItem[] {
  if (capabilities?.status !== 'ready') return [];
  const fields: DifyUserInputFormItem[] = capabilities.fields.map(field => ({
    [field.type]: {
      variable: field.key,
      label: field.label,
      required: field.required,
      default: field.default ?? '',
      options: field.options ?? [],
      max_length: field.maxLength,
      min: field.min,
      max: field.max,
      step: field.step,
      precision: field.precision,
    },
  }));
  for (const slot of capabilities.attachmentSlots.filter(
    slot => slot.target === 'inputs'
  )) {
    fields.push({
      [(slot.multiple ?? slot.maxCount !== 1) ? 'file-list' : 'file']: {
        variable: slot.key,
        label: slot.label,
        required: slot.minCount > 0,
        default: [],
        number_limits: slot.maxCount,
      },
    });
  }
  return filterVisibleUserInputForm(fields);
}

function hasUploadFileId(value: unknown): value is { upload_file_id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return typeof (value as Record<string, unknown>).upload_file_id === 'string';
}

/**
 * Validate workflow form data
 *
 * @param formData form data
 * @param userInputForm form configuration
 * @param t translation function for workflow validation messages
 * @returns validation error object
 */
export function validateFormData(
  formData: Record<string, unknown>,
  userInputForm: DifyUserInputFormItem[],
  t: (key: string, params?: Record<string, string | number | Date>) => string,
  capabilities?: AgentInputCapabilities | null
): Record<string, string> {
  const errors: Record<string, string> = {};

  filterVisibleUserInputForm(userInputForm).forEach(formItem => {
    const { fieldType, fieldConfig } = getDifyUserInputFormEntry(formItem);

    if (!fieldConfig) return;

    const { variable, required, label } = fieldConfig;
    const value = formData[variable];

    // Check if the field is empty
    const isFileField = fieldType === 'file' || fieldType === 'file-list';
    const isNumberField = fieldType === 'number';

    if (isFileField) {
      const slot =
        capabilities?.status === 'ready'
          ? capabilities.attachmentSlots.find(
              slot => slot.target === 'inputs' && slot.key === variable
            )
          : undefined;
      const fileArray =
        value == null ? [] : Array.isArray(value) ? value : [value];
      if (!slot) {
        if (fileArray.length || capabilities?.status !== 'ready')
          errors[variable] = 'INPUT_CAPABILITIES_UNAVAILABLE';
        return;
      }
      const countError = validateInputFileCount(slot, fileArray.length);
      if (countError) {
        errors[variable] =
          countError === 'INPUT_FILES_REQUIRED'
            ? t('validation.required', { label })
            : t('validation.tooManyFiles', { label, maxFiles: slot.maxCount });
        return;
      }
      const seen = new Set<string>();
      for (const file of fileArray) {
        const record = file as Record<string, unknown> | null;
        if (!record || typeof record !== 'object') {
          errors[variable] = 'INPUT_FILE_METADATA_REQUIRED';
          break;
        }
        const fileError = validateInputFile(
          slot,
          file instanceof File
            ? file
            : {
                name: typeof record.name === 'string' ? record.name : '',
                size: typeof record.size === 'number' ? record.size : NaN,
                type:
                  typeof record.mime_type === 'string' ? record.mime_type : '',
              }
        );
        if (fileError) {
          errors[variable] = fileError;
          break;
        }
        if (!(file instanceof File)) {
          if (
            !hasUploadFileId(file) ||
            !file.upload_file_id ||
            seen.has(file.upload_file_id)
          ) {
            errors[variable] = 'INPUT_FILE_REFERENCE_INVALID';
            break;
          }
          seen.add(file.upload_file_id);
        } else {
          errors[variable] = 'INPUT_UPLOAD_PENDING';
          break;
        }
      }
      return;
    }

    const isEmpty = isFileField
      ? !value ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' &&
          !Array.isArray(value) &&
          !hasUploadFileId(value))
      : isNumberField
        ? value === '' || value === null || value === undefined
        : !value || (typeof value === 'string' && value.trim() === '');

    // If the field is empty and not required, skip all validation
    if (isEmpty && !required) {
      return;
    }

    // Required validation
    if (isEmpty && required) {
      errors[variable] = t('validation.required', { label });
      return;
    }

    // Number type validation
    if (fieldType === 'number') {
      const numberConfig = fieldConfig as DifyNumberInputControl;

      // Check if it is a valid number
      const numValue =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? parseFloat(value)
            : Number.NaN;
      if (isNaN(numValue)) {
        errors[variable] = t('validation.invalidNumber', { label });
        return;
      }

      // Minimum value validation
      if (numberConfig.min !== undefined && numValue < numberConfig.min) {
        errors[variable] = t('validation.minValue', {
          label,
          min: numberConfig.min,
        });
        return;
      }

      // Maximum value validation
      if (numberConfig.max !== undefined && numValue > numberConfig.max) {
        errors[variable] = t('validation.maxValue', {
          label,
          max: numberConfig.max,
        });
        return;
      }

      // Step validation
      if (numberConfig.step && numberConfig.step > 0) {
        const minValue = numberConfig.min || 0;
        const remainder = (numValue - minValue) % numberConfig.step;
        if (Math.abs(remainder) > 1e-10) {
          // Use small tolerance to handle floating point precision issues
          errors[variable] = t('validation.stepValue', {
            label,
            step: numberConfig.step,
          });
          return;
        }
      }

      // Precision validation (decimal places)
      if (numberConfig.precision !== undefined) {
        const decimalPlaces = (numValue.toString().split('.')[1] || '').length;
        if (decimalPlaces > numberConfig.precision) {
          errors[variable] = t('validation.precisionExceeded', {
            label,
            precision: numberConfig.precision,
          });
          return;
        }
      }
    }

    // Character length validation (only applicable to text fields)
    if (fieldType === 'text-input' || fieldType === 'paragraph') {
      const textConfig = fieldConfig as DifyTextInputControl & {
        max_length?: number;
      };
      const maxLength = textConfig.max_length;
      if (maxLength && typeof value === 'string' && value.length > maxLength) {
        errors[variable] = t('validation.maxLengthExceeded', {
          label,
          maxLength,
        });
      }
    }

    // Dropdown selection validation
    if (fieldType === 'select') {
      const selectConfig = fieldConfig as DifySelectControl;
      if (
        selectConfig.options &&
        (typeof value !== 'string' || !selectConfig.options.includes(value))
      ) {
        errors[variable] = t('validation.invalidSelection', { label });
      }
    }
  });

  return errors;
}
