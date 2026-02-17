'use client';

import type { DifyUserInputFormItem } from '@lib/services/dify/types';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';
import { cn } from '@lib/utils';
import { AlertCircle, Loader2, Play } from 'lucide-react';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { FileUploadField } from './file-upload-field';
import { FormField } from './form-field';
import { validateFormData } from './validation';

type WorkflowFormData = Record<string, unknown>;
type WorkflowAppConfig = {
  dify_parameters?: DifyParametersSimplifiedConfig;
} | null;

interface WorkflowInputFormProps {
  instanceId: string;
  onExecute: (formData: WorkflowFormData) => Promise<void>;
  isExecuting: boolean;
}

export interface WorkflowInputFormRef {
  resetForm: () => void;
}

/**
 * Dynamic input form component for workflow
 *
 * Features:
 * - Dynamically render form fields based on user_input_form configuration
 * - Support text, paragraph, dropdown selection, file upload, etc.
 * - Complete form validation and error hint
 * - Unified stone color theme
 * - Support form reset function
 */
export const WorkflowInputForm = React.forwardRef<
  WorkflowInputFormRef,
  WorkflowInputFormProps
>(({ instanceId, onExecute, isExecuting }, ref) => {
  const t = useTranslations('pages.workflow.form');

  // --- State management ---
  const [formData, setFormData] = useState<WorkflowFormData>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [appConfig, setAppConfig] = useState<WorkflowAppConfig>(null);
  const [initialFormData, setInitialFormData] = useState<WorkflowFormData>({});

  // --- Initialize application configuration ---
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        console.log(
          '[Form initialization] Start loading application configuration, instanceId:',
          instanceId
        );

        // Directly get the configuration of the specified instanceId from internal API
        try {
          const response = await fetch(
            `/api/internal/apps?instanceId=${encodeURIComponent(instanceId)}`,
            {
              method: 'GET',
              credentials: 'include',
            }
          );

          if (!response.ok) {
            throw new Error(t('errors.instanceNotFound', { instanceId }));
          }

          const payload = (await response.json()) as {
            success: boolean;
            app?: {
              config?: WorkflowAppConfig;
            };
          };

          const serviceInstance = payload.app;
          if (!payload.success || !serviceInstance) {
            throw new Error(t('errors.instanceNotFound', { instanceId }));
          }

          setAppConfig(serviceInstance.config ?? null);

          // Initialize form default value
          const difyParams = serviceInstance.config
            ?.dify_parameters as DifyParametersSimplifiedConfig;
          const userInputForm = difyParams?.user_input_form || [];
          const initialData: WorkflowFormData = {};

          userInputForm.forEach((formItem: DifyUserInputFormItem) => {
            const fieldType = Object.keys(formItem)[0];
            const fieldConfig = formItem[fieldType as keyof typeof formItem];

            if (fieldConfig) {
              // Set default value based on field type
              if (fieldType === 'file' || fieldType === 'file-list') {
                initialData[fieldConfig.variable] = fieldConfig.default || [];
              } else if (fieldType === 'number') {
                const numberDefault = fieldConfig.default;
                initialData[fieldConfig.variable] =
                  typeof numberDefault === 'number' ||
                  typeof numberDefault === 'string'
                    ? numberDefault
                    : '';
              } else {
                initialData[fieldConfig.variable] = fieldConfig.default || '';
              }
            }
          });

          setFormData(initialData);
          setInitialFormData(initialData);
        } catch (configError) {
          console.warn(
            '[Form initialization] Failed to get application configuration, using default configuration:',
            configError
          );

          // Set default configuration, allow users to continue using
          const defaultConfig = {
            dify_parameters: {
              user_input_form: [
                {
                  paragraph: {
                    type: 'paragraph',
                    label: t('defaultLabel'),
                    variable: 'input_text',
                    required: true,
                    default: '',
                  },
                },
              ],
            },
          };

          setAppConfig(defaultConfig);

          const defaultFormData = { input_text: '' };
          setFormData(defaultFormData);
          setInitialFormData(defaultFormData);
        }
      } catch (error) {
        console.error('[Form initialization] Initialization failed:', error);

        // Even if it completely fails, provide a basic form
        const fallbackConfig = {
          dify_parameters: {
            user_input_form: [
              {
                paragraph: {
                  type: 'paragraph',
                  label: t('defaultLabel'),
                  variable: 'input_text',
                  required: true,
                  default: '',
                },
              },
            ],
          },
        };
        setAppConfig(fallbackConfig);

        const fallbackFormData = { input_text: '' };
        setFormData(fallbackFormData);
        setInitialFormData(fallbackFormData);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [instanceId, t]);

  // --- Form field update ---
  const handleFieldChange = (variable: string, value: unknown) => {
    setFormData(prev => ({
      ...prev,
      [variable]: value,
    }));

    // Clear the error of this field
    if (errors[variable]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[variable];
        return newErrors;
      });
    }
  };

  // --- Form reset ---
  const handleReset = useCallback(() => {
    setFormData({ ...initialFormData });
    setErrors({});
  }, [initialFormData]);

  // --- Form submission ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isExecuting) return;

    // Validate the form
    const userInputForm = appConfig?.dify_parameters?.user_input_form || [];
    const validationErrors = validateFormData(formData, userInputForm, t);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Clear errors and execute
    setErrors({});
    await onExecute(formData);
  };

  // --- Expose reset method to parent component ---
  React.useImperativeHandle(
    ref,
    () => ({
      resetForm: handleReset,
    }),
    [handleReset]
  );

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-4 text-center">
          <Loader2
            className={cn(
              'mx-auto h-8 w-8 animate-spin',
              'text-stone-600 dark:text-stone-400'
            )}
          />
          <p
            className={cn(
              'font-serif text-sm',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {t('loading')}
          </p>
        </div>
      </div>
    );
  }

  // --- Get form configuration ---
  const userInputForm = appConfig?.dify_parameters?.user_input_form || [];

  if (userInputForm.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-4 text-center">
          <AlertCircle
            className={cn(
              'mx-auto h-8 w-8',
              'text-stone-600 dark:text-stone-400'
            )}
          />
          <p
            className={cn(
              'font-serif text-sm',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {t('noFormConfig')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* --- Form content --- */}
      <form
        onSubmit={handleSubmit}
        className="hide-all-scrollbars flex min-h-0 flex-1 flex-col"
      >
        <div className="no-scrollbar flex-1 space-y-6 overflow-x-visible overflow-y-auto px-2">
          {userInputForm.map(
            (formItem: DifyUserInputFormItem, index: number) => {
              const fieldType = Object.keys(formItem)[0];
              const fieldConfig = formItem[fieldType as keyof typeof formItem];

              if (!fieldConfig) return null;

              // Special handling for file upload fields
              if (fieldType === 'file' || fieldType === 'file-list') {
                return (
                  <FileUploadField
                    key={`${fieldConfig.variable}-${index}`}
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
                    onChange={value =>
                      handleFieldChange(fieldConfig.variable, value)
                    }
                    error={errors[fieldConfig.variable]}
                    label={fieldConfig.label}
                    instanceId={instanceId}
                    isSingleFileMode={fieldType === 'file'}
                  />
                );
              }

              // Other field types
              return (
                <FormField
                  key={`${fieldConfig.variable}-${index}`}
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
                  onChange={value =>
                    handleFieldChange(fieldConfig.variable, value)
                  }
                  error={errors[fieldConfig.variable]}
                />
              );
            }
          )}
        </div>

        {/* --- Form operation buttons --- */}
        <div
          className={cn(
            'mt-4 flex-shrink-0 border-t bg-gradient-to-t pt-6',
            'border-stone-200 dark:border-stone-700'
          )}
        >
          <div className="flex gap-3">
            {/* Reset button */}
            <button
              type="button"
              onClick={handleReset}
              disabled={isExecuting}
              className={cn(
                'rounded-lg px-4 py-2 font-serif text-sm transition-colors',
                'border',
                isExecuting ? 'cursor-not-allowed opacity-50' : '',
                'border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-800 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
              )}
            >
              {t('reset')}
            </button>

            {/* Execute button */}
            <button
              type="submit"
              disabled={isExecuting}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-6 py-2',
                'font-serif text-sm font-medium transition-colors',
                isExecuting
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:shadow-lg',
                'bg-stone-800 text-white hover:bg-stone-700 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600'
              )}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('executing')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {t('startExecution')}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
});

WorkflowInputForm.displayName = 'WorkflowInputForm';
