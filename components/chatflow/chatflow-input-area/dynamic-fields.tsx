import { FileUploadField } from '@components/workflow/workflow-input-form/file-upload-field';
import { FormField } from '@components/workflow/workflow-input-form/form-field';
import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import { cn } from '@lib/utils';

import type { ChatflowFormData } from './types';

interface ChatflowDynamicFieldsProps {
  errors: Record<string, string>;
  formData: ChatflowFormData;
  hasFormConfig: boolean;
  instanceId: string;
  onFieldChange: (variable: string, value: unknown) => void;
  sectionTitle: string;
  userInputForm: DifyUserInputFormItem[];
}

export function ChatflowDynamicFields({
  errors,
  formData,
  hasFormConfig,
  instanceId,
  onFieldChange,
  sectionTitle,
  userInputForm,
}: ChatflowDynamicFieldsProps) {
  if (!hasFormConfig || userInputForm.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
            'via-stone-300 dark:via-stone-600'
          )}
        />
        <span
          className={cn(
            'rounded-full border px-4 py-2 font-serif text-sm',
            'border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
          )}
        >
          {sectionTitle}
        </span>
        <div
          className={cn(
            'h-px flex-1 bg-gradient-to-r from-transparent to-transparent',
            'via-stone-300 dark:via-stone-600'
          )}
        />
      </div>

      <div className="grid gap-6">
        {userInputForm.map((formItem, index) => {
          const fieldType = Object.keys(formItem)[0];
          const fieldConfig = formItem[fieldType as keyof typeof formItem];

          if (!fieldConfig) {
            return null;
          }

          return (
            <div
              key={`${fieldConfig.variable}-${index}`}
              className={cn(
                'group relative rounded-xl p-6 transition-all duration-300',
                'border border-stone-200/60 bg-gradient-to-br from-stone-50/80 to-white/80 hover:border-stone-300 hover:shadow-lg hover:shadow-stone-200/50 dark:border-stone-600/60 dark:bg-gradient-to-br dark:from-stone-800/80 dark:to-stone-700/80 dark:hover:border-stone-500 dark:hover:shadow-lg dark:hover:shadow-stone-900/50'
              )}
            >
              <div
                className={cn(
                  'absolute top-0 left-6 h-1 w-12 rounded-full transition-all duration-300 group-hover:w-16',
                  'bg-gradient-to-r from-stone-400 to-stone-300 dark:bg-gradient-to-r dark:from-stone-500 dark:to-stone-600'
                )}
              />

              {fieldType === 'file' || fieldType === 'file-list' ? (
                <FileUploadField
                  config={
                    fieldConfig as {
                      enabled?: boolean;
                      max_length?: number;
                      number_limits?: number;
                      allowed_file_types?: string[];
                      max_file_size_mb?: number;
                    }
                  }
                  value={formData[fieldConfig.variable]}
                  onChange={value => onFieldChange(fieldConfig.variable, value)}
                  error={errors[fieldConfig.variable]}
                  label={fieldConfig.label}
                  instanceId={instanceId}
                  isSingleFileMode={fieldType === 'file'}
                />
              ) : (
                <FormField
                  type={
                    fieldType as
                      | 'text-input'
                      | 'number'
                      | 'paragraph'
                      | 'select'
                  }
                  config={fieldConfig}
                  value={
                    formData[fieldConfig.variable] as
                      | string
                      | number
                      | string[]
                      | File[]
                  }
                  onChange={value => onFieldChange(fieldConfig.variable, value)}
                  error={errors[fieldConfig.variable]}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
