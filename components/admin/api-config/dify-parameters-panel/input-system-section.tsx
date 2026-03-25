import { cn } from '@lib/utils';
import { ChevronDown, ChevronRight, FormInput, Settings2 } from 'lucide-react';

import type { DifyPanelSectionProps } from './types';

const SYSTEM_PARAMETER_FIELDS: Array<{
  field:
    | 'file_size_limit'
    | 'image_file_size_limit'
    | 'audio_file_size_limit'
    | 'video_file_size_limit';
  labelKey: string;
  max: number;
}> = [
  {
    field: 'file_size_limit',
    labelKey: 'sections.systemParameters.fileSizeLimit',
    max: 100,
  },
  {
    field: 'image_file_size_limit',
    labelKey: 'sections.systemParameters.imageSizeLimit',
    max: 50,
  },
  {
    field: 'audio_file_size_limit',
    labelKey: 'sections.systemParameters.audioSizeLimit',
    max: 200,
  },
  {
    field: 'video_file_size_limit',
    labelKey: 'sections.systemParameters.videoSizeLimit',
    max: 500,
  },
];

export function InputSystemSection({
  isDark,
  t,
  localConfig,
  expandedSections,
  toggleSection,
  updateConfig,
}: DifyPanelSectionProps) {
  return (
    <>
      <div className="space-y-4">
        <button
          onClick={() => toggleSection('user_input')}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors',
            isDark
              ? 'bg-stone-800 hover:bg-stone-700'
              : 'bg-stone-50 hover:bg-stone-100'
          )}
        >
          <FormInput
            className={cn(
              'h-4 w-4',
              isDark ? 'text-stone-400' : 'text-stone-600'
            )}
          />
          <span
            className={cn(
              'flex-1 text-left font-serif font-medium',
              isDark ? 'text-stone-200' : 'text-stone-800'
            )}
          >
            {t('sections.userInputForm.title')}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'font-serif text-xs',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            >
              {t('sections.userInputForm.fieldsCount', {
                count: localConfig.user_input_form?.length || 0,
              })}
            </span>
            {expandedSections.has('user_input') ? (
              <ChevronDown className="h-4 w-4 text-stone-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-stone-400" />
            )}
          </div>
        </button>

        {expandedSections.has('user_input') && (
          <div
            className={cn(
              'space-y-4 rounded-xl border p-4',
              isDark
                ? 'border-stone-700 bg-stone-800/50'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div
              className={cn(
                'font-serif text-sm',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            >
              {t('sections.userInputForm.description')}
            </div>

            {(localConfig.user_input_form || []).length > 0 ? (
              <div className="space-y-3">
                {(localConfig.user_input_form || []).map((formItem, index) => {
                  const fieldType = Object.keys(formItem)[0];
                  const fieldConfig =
                    formItem[fieldType as keyof typeof formItem];

                  return (
                    <div
                      key={index}
                      className={cn(
                        'rounded-lg border p-3',
                        isDark
                          ? 'border-stone-600 bg-stone-700/50'
                          : 'border-stone-300 bg-stone-100/50'
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className={cn(
                            'font-serif text-sm font-medium',
                            isDark ? 'text-stone-200' : 'text-stone-800'
                          )}
                        >
                          {fieldConfig?.label ||
                            t('sections.userInputForm.fieldLabel', {
                              index: index + 1,
                            })}
                        </span>
                        <span
                          className={cn(
                            'rounded px-2 py-1 font-serif text-xs',
                            isDark
                              ? 'bg-stone-600 text-stone-300'
                              : 'bg-stone-200 text-stone-700'
                          )}
                        >
                          {fieldType}
                        </span>
                      </div>
                      <div
                        className={cn(
                          'font-serif text-xs',
                          isDark ? 'text-stone-400' : 'text-stone-600'
                        )}
                      >
                        {t('sections.userInputForm.fieldInfo', {
                          variable: fieldConfig?.variable || 'N/A',
                          required: fieldConfig?.required
                            ? t('sections.userInputForm.fieldRequired')
                            : t('sections.userInputForm.fieldOptional'),
                          defaultValue:
                            fieldConfig?.default ||
                            t('sections.userInputForm.fieldNoDefault'),
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={cn(
                  'py-8 text-center font-serif text-sm',
                  isDark ? 'text-stone-500' : 'text-stone-400'
                )}
              >
                {t('sections.userInputForm.noFields')}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <button
          onClick={() => toggleSection('system')}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors',
            isDark
              ? 'bg-stone-800 hover:bg-stone-700'
              : 'bg-stone-50 hover:bg-stone-100'
          )}
        >
          <Settings2
            className={cn(
              'h-4 w-4',
              isDark ? 'text-stone-400' : 'text-stone-600'
            )}
          />
          <span
            className={cn(
              'flex-1 text-left font-serif font-medium',
              isDark ? 'text-stone-200' : 'text-stone-800'
            )}
          >
            {t('sections.systemParameters.title')}
          </span>
          {expandedSections.has('system') ? (
            <ChevronDown className="h-4 w-4 text-stone-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-stone-400" />
          )}
        </button>

        {expandedSections.has('system') && (
          <div
            className={cn(
              'space-y-4 rounded-xl border p-4',
              isDark
                ? 'border-stone-700 bg-stone-800/50'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div className="grid grid-cols-2 gap-4">
              {SYSTEM_PARAMETER_FIELDS.map(({ field, labelKey, max }) => (
                <div key={field}>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t(labelKey)}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={String(max)}
                    value={localConfig.system_parameters?.[field] || 0}
                    onChange={event =>
                      updateConfig(
                        `system_parameters.${field}`,
                        parseInt(event.target.value, 10)
                      )
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 font-serif',
                      isDark
                        ? 'border-stone-600 bg-stone-700 text-stone-100'
                        : 'border-stone-300 bg-white text-stone-900'
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
