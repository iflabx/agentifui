import { validateFormData } from '@components/workflow/workflow-input-form/validation';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import {
  filterVisibleUserInputForm,
  getDifyUserInputFormEntry,
} from '@lib/services/dify/user-input-form';

import type {
  ChatflowFormConfigResult,
  ChatflowFormData,
  UploadPayloadFile,
} from './types';

const MAX_QUERY_LENGTH = 2000;

type TranslateFn = (
  key: string,
  params?: Record<string, string | number | Date>
) => string;

function getFieldConfig(formItem: DifyUserInputFormItem) {
  return getDifyUserInputFormEntry(formItem);
}

export function buildChatflowFormConfig(
  formItems: DifyUserInputFormItem[] | undefined
): ChatflowFormConfigResult {
  const visibleFormItems = filterVisibleUserInputForm(formItems);

  if (visibleFormItems.length === 0) {
    return {
      hasFormConfig: false,
      initialFormData: {},
      userInputForm: [],
    };
  }

  const initialData: ChatflowFormData = {};

  visibleFormItems.forEach(formItem => {
    const { fieldType, fieldConfig } = getFieldConfig(formItem);
    if (!fieldConfig) {
      return;
    }

    if (fieldType === 'file' || fieldType === 'file-list') {
      initialData[fieldConfig.variable] = fieldConfig.default || [];
      return;
    }

    if (fieldType === 'number') {
      const numberDefault = fieldConfig.default;
      initialData[fieldConfig.variable] =
        typeof numberDefault === 'number' || typeof numberDefault === 'string'
          ? numberDefault
          : '';
      return;
    }

    initialData[fieldConfig.variable] = fieldConfig.default || '';
  });

  return {
    hasFormConfig: true,
    initialFormData: initialData,
    userInputForm: visibleFormItems,
  };
}

export function validateChatflowSubmission(input: {
  formData: ChatflowFormData;
  hasFormConfig: boolean;
  query: string;
  t: TranslateFn;
  tWorkflow: TranslateFn;
  userInputForm: DifyUserInputFormItem[];
}) {
  const errors: Record<string, string> = {};

  if (!input.query.trim()) {
    errors.query = input.t('form.question.required');
  } else if (input.query.length > MAX_QUERY_LENGTH) {
    errors.query = input.t('form.question.tooLong', {
      maxLength: MAX_QUERY_LENGTH,
    });
  }

  if (input.hasFormConfig && input.userInputForm.length > 0) {
    Object.assign(
      errors,
      validateFormData(input.formData, input.userInputForm, input.tWorkflow)
    );
  }

  return errors;
}

export function isUploadPayloadFile(
  value: unknown
): value is UploadPayloadFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return 'file' in record || 'upload_file_id' in record;
}

export function extractFilesFromFormData(
  formData: ChatflowFormData
): UploadPayloadFile[] {
  const files: UploadPayloadFile[] = [];

  Object.values(formData).forEach(value => {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (isUploadPayloadFile(item)) {
          files.push(item);
        }
      });
      return;
    }

    if (isUploadPayloadFile(value)) {
      files.push(value);
    }
  });

  return files;
}

export function isChatflowFormPristine(
  query: string,
  formData: ChatflowFormData
) {
  return (
    !query &&
    Object.values(formData).every(
      value => !value || (Array.isArray(value) && value.length === 0)
    )
  );
}
