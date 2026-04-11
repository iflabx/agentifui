import type { DifyUserInputFormItem } from './types';

export const SYSTEM_INJECTED_USER_FIELD_PREFIX = 'agentifui_user_';

export function isSystemInjectedUserField(variable: unknown): boolean {
  if (typeof variable !== 'string') {
    return false;
  }

  return variable.trim().startsWith(SYSTEM_INJECTED_USER_FIELD_PREFIX);
}

export function getDifyUserInputFormEntry(formItem: DifyUserInputFormItem): {
  fieldType: string;
  fieldConfig: DifyUserInputFormItem[keyof DifyUserInputFormItem] | undefined;
} {
  const fieldType = Object.keys(formItem)[0] || '';
  const fieldConfig = formItem[fieldType as keyof typeof formItem];

  return {
    fieldType,
    fieldConfig,
  };
}

export function filterVisibleUserInputForm(
  formItems: DifyUserInputFormItem[] | undefined
): DifyUserInputFormItem[] {
  if (!Array.isArray(formItems) || formItems.length === 0) {
    return [];
  }

  return formItems.filter(formItem => {
    const { fieldConfig } = getDifyUserInputFormEntry(formItem);
    if (!fieldConfig) {
      return false;
    }

    return !isSystemInjectedUserField(fieldConfig.variable);
  });
}
