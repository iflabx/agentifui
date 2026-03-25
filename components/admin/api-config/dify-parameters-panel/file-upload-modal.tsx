import { FILE_TYPE_CONFIG } from '@lib/constants/file-types';
import { cn } from '@lib/utils';
import { X } from 'lucide-react';

import type { FileUploadModalProps } from './types';

export function FileUploadModal({
  isDark,
  t,
  fileUploadState,
  setUploadMethod,
  setMaxFiles,
  toggleFileType,
  setCustomFileTypes,
  onCancel,
  onSave,
}: FileUploadModalProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-60 cursor-pointer bg-black/30 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="fixed inset-x-4 top-4 bottom-24 z-60 flex items-center justify-center">
        <div className="flex max-h-full w-full max-w-[420px] flex-col">
          <div
            className={cn(
              'flex h-full flex-col rounded-xl border shadow-2xl',
              isDark
                ? 'border-stone-700 bg-stone-900'
                : 'border-stone-200 bg-white'
            )}
          >
            <div
              className={cn(
                'flex flex-shrink-0 items-center justify-between border-b p-4',
                isDark ? 'border-stone-700' : 'border-stone-200'
              )}
            >
              <h3
                className={cn(
                  'font-serif text-base font-bold',
                  isDark ? 'text-stone-100' : 'text-stone-900'
                )}
              >
                {t('fileUploadModal.title')}
              </h3>
              <button
                onClick={onCancel}
                className={cn(
                  'cursor-pointer rounded-lg p-1.5 transition-colors',
                  isDark
                    ? 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('fileUploadModal.uploadMethod.label')}
                  </label>
                  <div className="flex gap-1.5">
                    {(['local', 'url', 'both'] as const).map(method => (
                      <button
                        key={method}
                        onClick={() => setUploadMethod(method)}
                        className={cn(
                          'cursor-pointer rounded-lg px-3 py-1.5 font-serif text-xs transition-colors',
                          fileUploadState.uploadMethod === method
                            ? isDark
                              ? 'bg-stone-600 text-white'
                              : 'bg-stone-700 text-white'
                            : isDark
                              ? 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        )}
                      >
                        {t(`fileUploadModal.uploadMethod.${method}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('fileUploadModal.maxFiles.label')}
                  </label>
                  <p
                    className={cn(
                      'mb-2 font-serif text-xs',
                      isDark ? 'text-stone-400' : 'text-stone-600'
                    )}
                  >
                    {t('fileUploadModal.maxFiles.description')}
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={fileUploadState.maxFiles}
                      onChange={event =>
                        setMaxFiles(parseInt(event.target.value, 10))
                      }
                      className={cn(
                        'flex-1 cursor-pointer',
                        isDark ? 'accent-stone-600' : 'accent-stone-700'
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-[1.5rem] text-center font-serif text-base font-medium',
                        isDark ? 'text-stone-200' : 'text-stone-800'
                      )}
                    >
                      {fileUploadState.maxFiles}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    className={cn(
                      'mb-2 block font-serif text-sm font-medium',
                      isDark ? 'text-stone-300' : 'text-stone-700'
                    )}
                  >
                    {t('fileUploadModal.fileTypes.label')}
                  </label>
                  <div className="space-y-2">
                    {Object.entries(FILE_TYPE_CONFIG).map(
                      ([fileType, config]) => {
                        const IconComponent = config.icon;
                        const isEnabled =
                          fileUploadState.enabledFileTypes.has(fileType);

                        return (
                          <div key={fileType} className="space-y-2">
                            <div
                              className={cn(
                                'flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
                                isEnabled
                                  ? isDark
                                    ? 'border-stone-500 bg-stone-700/50'
                                    : 'border-stone-400 bg-stone-100/50'
                                  : isDark
                                    ? 'border-stone-600 bg-stone-800/50'
                                    : 'border-stone-200 bg-stone-50/50'
                              )}
                              onClick={() => toggleFileType(fileType)}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    'rounded-lg p-1.5',
                                    isEnabled
                                      ? isDark
                                        ? 'bg-stone-600 text-white'
                                        : 'bg-stone-700 text-white'
                                      : isDark
                                        ? 'bg-stone-700 text-stone-400'
                                        : 'bg-stone-200 text-stone-600'
                                  )}
                                >
                                  <IconComponent className="h-3 w-3" />
                                </div>
                                <div>
                                  <div
                                    className={cn(
                                      'font-serif text-sm font-medium',
                                      isDark
                                        ? 'text-stone-200'
                                        : 'text-stone-800'
                                    )}
                                  >
                                    {t(`fileUploadModal.fileTypes.${fileType}`)}
                                  </div>
                                  <div
                                    className={cn(
                                      'font-serif text-xs',
                                      isDark
                                        ? 'text-stone-400'
                                        : 'text-stone-600'
                                    )}
                                  >
                                    {config.extensions.length > 0
                                      ? `${config.extensions.slice(0, 3).join(', ').toUpperCase()}${config.extensions.length > 3 ? '...' : ''}`
                                      : config.maxSize}
                                  </div>
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() => toggleFileType(fileType)}
                                className={cn(
                                  'h-4 w-4 cursor-pointer rounded border',
                                  isEnabled
                                    ? isDark
                                      ? 'border-stone-600 bg-stone-600 accent-stone-600'
                                      : 'border-stone-700 bg-stone-700 accent-stone-700'
                                    : isDark
                                      ? 'border-stone-500 accent-stone-600'
                                      : 'border-stone-300 accent-stone-700'
                                )}
                              />
                            </div>

                            {fileType === 'other' && isEnabled && (
                              <div
                                className={cn(
                                  'ml-4 rounded-lg border p-3',
                                  isDark
                                    ? 'border-stone-600 bg-stone-800'
                                    : 'border-stone-200 bg-stone-50'
                                )}
                              >
                                <label
                                  className={cn(
                                    'mb-2 block font-serif text-xs font-medium',
                                    isDark ? 'text-stone-300' : 'text-stone-700'
                                  )}
                                >
                                  {t(
                                    'fileUploadModal.fileTypes.customDescription'
                                  )}
                                </label>
                                <input
                                  type="text"
                                  value={fileUploadState.customFileTypes}
                                  onChange={event =>
                                    setCustomFileTypes(event.target.value)
                                  }
                                  className={cn(
                                    'w-full rounded border px-2 py-1.5 font-serif text-xs',
                                    isDark
                                      ? 'border-stone-600 bg-stone-700 text-stone-100 placeholder-stone-400'
                                      : 'border-stone-300 bg-white text-stone-900 placeholder-stone-500'
                                  )}
                                  placeholder={t(
                                    'fileUploadModal.fileTypes.customPlaceholder'
                                  )}
                                />
                                <p
                                  className={cn(
                                    'mt-1 font-serif text-xs',
                                    isDark ? 'text-stone-400' : 'text-stone-600'
                                  )}
                                >
                                  {t(
                                    'fileUploadModal.fileTypes.customDescription'
                                  )}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={cn(
                'flex flex-shrink-0 gap-2 border-t p-4',
                isDark ? 'border-stone-700' : 'border-stone-200'
              )}
            >
              <button
                onClick={onCancel}
                className={cn(
                  'flex-1 cursor-pointer rounded-lg px-3 py-2 font-serif text-sm font-medium transition-colors',
                  isDark
                    ? 'bg-stone-700 text-stone-200 hover:bg-stone-600'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                )}
              >
                {t('buttons.cancel')}
              </button>
              <button
                onClick={onSave}
                className={cn(
                  'flex-1 cursor-pointer rounded-lg px-3 py-2 font-serif text-sm font-medium transition-colors',
                  isDark
                    ? 'bg-stone-600 text-white hover:bg-stone-500'
                    : 'bg-stone-700 text-white hover:bg-stone-800'
                )}
              >
                {t('buttons.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
