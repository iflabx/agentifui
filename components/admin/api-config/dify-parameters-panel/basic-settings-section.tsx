import { cn } from '@lib/utils';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Mic,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

import type { BasicSettingsSectionProps } from './types';

export function BasicSettingsSection({
  isDark,
  t,
  localConfig,
  expandedSections,
  toggleSection,
  updateConfig,
  fileUploadState,
  onFileUploadToggle,
  onOpenFileUploadModal,
  addSuggestedQuestion,
  updateSuggestedQuestion,
  removeSuggestedQuestion,
}: BasicSettingsSectionProps) {
  return (
    <>
      <div className="space-y-4">
        <button
          onClick={() => toggleSection('basic')}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors',
            isDark
              ? 'bg-stone-800 hover:bg-stone-700'
              : 'bg-stone-50 hover:bg-stone-100'
          )}
        >
          <MessageSquare
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
            {t('sections.basic.title')}
          </span>
          {expandedSections.has('basic') ? (
            <ChevronDown
              className={cn(
                'h-4 w-4',
                isDark ? 'text-stone-400' : 'text-stone-500'
              )}
            />
          ) : (
            <ChevronRight
              className={cn(
                'h-4 w-4',
                isDark ? 'text-stone-400' : 'text-stone-500'
              )}
            />
          )}
        </button>

        {expandedSections.has('basic') && (
          <div
            className={cn(
              'space-y-4 rounded-xl border p-4',
              isDark
                ? 'border-stone-700 bg-stone-800/50'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  isDark ? 'text-stone-300' : 'text-stone-700'
                )}
              >
                {t('sections.basic.openingStatement.label')}
              </label>
              <textarea
                value={localConfig.opening_statement || ''}
                onChange={event =>
                  updateConfig('opening_statement', event.target.value)
                }
                className={cn(
                  'w-full resize-none rounded-lg border px-3 py-2 font-serif',
                  isDark
                    ? 'border-stone-600 bg-stone-700 text-stone-100 placeholder-stone-400'
                    : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500'
                )}
                placeholder={t('sections.basic.openingStatement.placeholder')}
                rows={3}
              />
            </div>

            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  isDark ? 'text-stone-300' : 'text-stone-700'
                )}
              >
                {t('sections.basic.suggestedQuestions.label')}
              </label>
              <div className="space-y-3">
                {(localConfig.suggested_questions || []).map(
                  (question, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={question}
                        onChange={event =>
                          updateSuggestedQuestion(index, event.target.value)
                        }
                        className={cn(
                          'flex-1 rounded-lg border px-3 py-2 font-serif',
                          isDark
                            ? 'border-stone-600 bg-stone-700 text-stone-100 placeholder-stone-400'
                            : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500'
                        )}
                        placeholder={t(
                          'sections.basic.suggestedQuestions.placeholder'
                        )}
                      />
                      <button
                        onClick={() => removeSuggestedQuestion(index)}
                        className={cn(
                          'cursor-pointer rounded-lg p-2 transition-colors',
                          isDark
                            ? 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                            : 'text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                        )}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                )}

                <button
                  onClick={addSuggestedQuestion}
                  className={cn(
                    'w-full cursor-pointer rounded-lg border border-dashed px-3 py-2 transition-colors',
                    'flex items-center justify-center gap-2 font-serif text-sm',
                    isDark
                      ? 'border-stone-600 text-stone-400 hover:border-stone-500 hover:text-stone-300'
                      : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:text-stone-700'
                  )}
                >
                  <Plus className="h-4 w-4" />
                  {t('sections.basic.suggestedQuestions.addButton')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between rounded-xl p-4',
            isDark ? 'bg-stone-800' : 'bg-stone-50'
          )}
        >
          <div className="flex items-center gap-3">
            <Sparkles
              className={cn(
                'h-4 w-4',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            />
            <span
              className={cn(
                'font-serif font-medium',
                isDark ? 'text-stone-200' : 'text-stone-800'
              )}
            >
              {t('sections.basic.suggestedQuestions.label')}
            </span>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={
                localConfig.suggested_questions_after_answer?.enabled || false
              }
              onChange={event =>
                updateConfig(
                  'suggested_questions_after_answer.enabled',
                  event.target.checked
                )
              }
              className="peer sr-only"
            />
            <div
              className={cn(
                'peer relative h-6 w-11 rounded-full transition-colors',
                'peer-focus:ring-2',
                localConfig.suggested_questions_after_answer?.enabled
                  ? isDark
                    ? 'bg-stone-600 peer-focus:ring-stone-500'
                    : 'bg-stone-700 peer-focus:ring-stone-300'
                  : isDark
                    ? 'bg-stone-600 peer-focus:ring-stone-500'
                    : 'bg-stone-300 peer-focus:ring-stone-300'
              )}
            >
              <div
                className={cn(
                  'absolute top-0.5 left-0.5 h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  localConfig.suggested_questions_after_answer?.enabled
                    ? 'translate-x-5'
                    : 'translate-x-0'
                )}
              />
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between rounded-xl p-4',
            isDark ? 'bg-stone-800' : 'bg-stone-50'
          )}
        >
          <div className="flex items-center gap-3">
            <Upload
              className={cn(
                'h-4 w-4',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            />
            <span
              className={cn(
                'font-serif font-medium',
                isDark ? 'text-stone-200' : 'text-stone-800'
              )}
            >
              {t('sections.fileUpload.title')}
            </span>
          </div>
          <div className="flex h-6 items-center gap-3">
            {fileUploadState.fileUploadEnabled && (
              <button
                onClick={onOpenFileUploadModal}
                className={cn(
                  'cursor-pointer rounded-lg p-2 transition-colors',
                  isDark
                    ? 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                    : 'text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                )}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={fileUploadState.fileUploadEnabled}
                onChange={event => onFileUploadToggle(event.target.checked)}
                className="peer sr-only"
              />
              <div
                className={cn(
                  'peer relative h-6 w-11 rounded-full transition-colors',
                  'peer-focus:ring-2',
                  fileUploadState.fileUploadEnabled
                    ? isDark
                      ? 'bg-stone-600 peer-focus:ring-stone-500'
                      : 'bg-stone-700 peer-focus:ring-stone-300'
                    : isDark
                      ? 'bg-stone-600 peer-focus:ring-stone-500'
                      : 'bg-stone-300 peer-focus:ring-stone-300'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 left-0.5 h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                    fileUploadState.fileUploadEnabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  )}
                />
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between rounded-xl p-4',
            isDark ? 'bg-stone-800' : 'bg-stone-50'
          )}
        >
          <div className="flex items-center gap-3">
            <Mic
              className={cn(
                'h-4 w-4',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            />
            <span
              className={cn(
                'font-serif font-medium',
                isDark ? 'text-stone-200' : 'text-stone-800'
              )}
            >
              {t('sections.speechToText.title')}
            </span>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={localConfig.speech_to_text?.enabled || false}
              onChange={event =>
                updateConfig('speech_to_text.enabled', event.target.checked)
              }
              className="peer sr-only"
            />
            <div
              className={cn(
                'peer relative h-6 w-11 rounded-full transition-colors',
                'peer-focus:ring-2',
                localConfig.speech_to_text?.enabled
                  ? isDark
                    ? 'bg-stone-600 peer-focus:ring-stone-500'
                    : 'bg-stone-700 peer-focus:ring-stone-300'
                  : isDark
                    ? 'bg-stone-600 peer-focus:ring-stone-500'
                    : 'bg-stone-300 peer-focus:ring-stone-300'
              )}
            >
              <div
                className={cn(
                  'absolute top-0.5 left-0.5 h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  localConfig.speech_to_text?.enabled
                    ? 'translate-x-5'
                    : 'translate-x-0'
                )}
              />
            </div>
          </label>
        </div>
      </div>
    </>
  );
}
