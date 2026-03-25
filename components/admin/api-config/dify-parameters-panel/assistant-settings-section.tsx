import { cn } from '@lib/utils';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Tag,
  Volume2,
} from 'lucide-react';

import type { DifyPanelSectionProps } from './types';

export function AssistantSettingsSection({
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
          onClick={() => toggleSection('tts')}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors',
            isDark
              ? 'bg-stone-800 hover:bg-stone-700'
              : 'bg-stone-50 hover:bg-stone-100'
          )}
        >
          <Volume2
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
            {t('sections.textToSpeech.title')}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'font-serif text-xs',
                localConfig.text_to_speech?.enabled
                  ? isDark
                    ? 'text-green-400'
                    : 'text-green-600'
                  : isDark
                    ? 'text-stone-500'
                    : 'text-stone-400'
              )}
            >
              {localConfig.text_to_speech?.enabled
                ? t('sections.textToSpeech.enabled')
                : t('sections.textToSpeech.disabled')}
            </span>
            {expandedSections.has('tts') ? (
              <ChevronDown className="h-4 w-4 text-stone-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-stone-400" />
            )}
          </div>
        </button>

        {expandedSections.has('tts') && (
          <div
            className={cn(
              'space-y-4 rounded-xl border p-4',
              isDark
                ? 'border-stone-700 bg-stone-800/50'
                : 'border-stone-200 bg-stone-50/50'
            )}
          >
            <div className="flex items-center justify-between">
              <label
                className={cn(
                  'font-serif text-sm font-medium',
                  isDark ? 'text-stone-300' : 'text-stone-700'
                )}
              >
                {t('sections.textToSpeech.enableLabel')}
              </label>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={localConfig.text_to_speech?.enabled || false}
                  onChange={event =>
                    updateConfig('text_to_speech.enabled', event.target.checked)
                  }
                  className="peer sr-only"
                />
                <div
                  className={cn(
                    'peer relative h-6 w-11 rounded-full transition-colors',
                    'peer-focus:ring-2',
                    localConfig.text_to_speech?.enabled
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
                      localConfig.text_to_speech?.enabled
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    )}
                  />
                </div>
              </label>
            </div>

            {localConfig.text_to_speech?.enabled && (
              <>
                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('sections.textToSpeech.voiceType.label')}
                  </label>
                  <input
                    type="text"
                    value={localConfig.text_to_speech?.voice || ''}
                    onChange={event =>
                      updateConfig('text_to_speech.voice', event.target.value)
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 font-serif',
                      isDark
                        ? 'border-stone-600 bg-stone-700 text-stone-100 placeholder-stone-400'
                        : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500'
                    )}
                    placeholder={t(
                      'sections.textToSpeech.voiceType.placeholder'
                    )}
                  />
                </div>

                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('sections.textToSpeech.language.label')}
                  </label>
                  <select
                    value={localConfig.text_to_speech?.language || ''}
                    onChange={event =>
                      updateConfig(
                        'text_to_speech.language',
                        event.target.value
                      )
                    }
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 font-serif',
                      isDark
                        ? 'border-stone-600 bg-stone-700 text-stone-100'
                        : 'border-stone-300 bg-white text-stone-900'
                    )}
                  >
                    <option value="">
                      {t('sections.textToSpeech.language.selectPlaceholder')}
                    </option>
                    <option value="zh">
                      {t('sections.textToSpeech.language.options.zh')}
                    </option>
                    <option value="en">
                      {t('sections.textToSpeech.language.options.en')}
                    </option>
                    <option value="ja">
                      {t('sections.textToSpeech.language.options.ja')}
                    </option>
                    <option value="ko">
                      {t('sections.textToSpeech.language.options.ko')}
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('sections.textToSpeech.autoPlay.label')}
                  </label>
                  <div className="flex gap-2">
                    {(['enabled', 'disabled'] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateConfig('text_to_speech.autoPlay', value)
                        }
                        className={cn(
                          'flex-1 cursor-pointer rounded-lg px-3 py-2 font-serif text-sm font-medium transition-colors',
                          localConfig.text_to_speech?.autoPlay === value
                            ? isDark
                              ? 'bg-stone-600 text-white'
                              : 'bg-stone-700 text-white'
                            : isDark
                              ? 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        )}
                      >
                        {t(`sections.textToSpeech.autoPlay.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
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
            <BookOpen
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
              {t('sections.retrieverResource.title')}
            </span>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={localConfig.retriever_resource?.enabled || false}
              onChange={event =>
                updateConfig('retriever_resource.enabled', event.target.checked)
              }
              className="peer sr-only"
            />
            <div
              className={cn(
                'peer relative h-6 w-11 rounded-full transition-colors',
                'peer-focus:ring-2',
                localConfig.retriever_resource?.enabled
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
                  localConfig.retriever_resource?.enabled
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
            <Tag
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
              {t('sections.annotationReply.title')}
            </span>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={localConfig.annotation_reply?.enabled || false}
              onChange={event =>
                updateConfig('annotation_reply.enabled', event.target.checked)
              }
              className="peer sr-only"
            />
            <div
              className={cn(
                'peer relative h-6 w-11 rounded-full transition-colors',
                'peer-focus:ring-2',
                localConfig.annotation_reply?.enabled
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
                  localConfig.annotation_reply?.enabled
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
