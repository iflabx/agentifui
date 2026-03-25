'use client';

import { useTheme } from '@lib/hooks/use-theme';
import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';
import { cn } from '@lib/utils';
import { RotateCcw, Save, X } from 'lucide-react';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AssistantSettingsSection } from './dify-parameters-panel/assistant-settings-section';
import { BasicSettingsSection } from './dify-parameters-panel/basic-settings-section';
import { FileUploadModal } from './dify-parameters-panel/file-upload-modal';
import {
  DEFAULT_FILE_UPLOAD_STATE,
  buildFileUploadConfig,
  cloneFileUploadPanelState,
  createInitializedDifyParametersConfig,
  extractFileUploadPanelState,
} from './dify-parameters-panel/file-upload-utils';
import { InputSystemSection } from './dify-parameters-panel/input-system-section';
import type { DifyParametersPanelProps } from './dify-parameters-panel/types';

const DifyParametersPanel: React.FC<DifyParametersPanelProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  instanceName = 'this app',
}) => {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.apiConfig.difyParametersPanel');
  const [localConfig, setLocalConfig] =
    useState<DifyParametersSimplifiedConfig>(config);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showFileUploadModal, setShowFileUploadModal] = useState(false);
  const [fileUploadState, setFileUploadState] = useState(
    DEFAULT_FILE_UPLOAD_STATE
  );
  const [initialFileUploadState, setInitialFileUploadState] = useState(
    DEFAULT_FILE_UPLOAD_STATE
  );

  useEffect(() => {
    setLocalConfig(createInitializedDifyParametersConfig(config));
    setHasChanges(false);
    setIsInitialized(false);

    const nextFileUploadState = extractFileUploadPanelState(config);
    setFileUploadState(nextFileUploadState);
    setInitialFileUploadState(cloneFileUploadPanelState(nextFileUploadState));

    const timeoutId = window.setTimeout(() => setIsInitialized(true), 100);
    return () => window.clearTimeout(timeoutId);
  }, [config]);

  useEffect(() => {
    if (isInitialized) {
      setHasChanges(JSON.stringify(localConfig) !== JSON.stringify(config));
    }
  }, [config, isInitialized, localConfig]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const updateConfig = (path: string, value: unknown) => {
    setLocalConfig(prev => {
      const next = { ...prev } as Record<string, unknown>;
      const keys = path.split('.');
      let current: Record<string, unknown> = next;

      for (let index = 0; index < keys.length - 1; index++) {
        if (!current[keys[index]]) {
          current[keys[index]] = {};
        }
        current = current[keys[index]] as Record<string, unknown>;
      }

      current[keys[keys.length - 1]] = value;
      return next as DifyParametersSimplifiedConfig;
    });
  };

  const generateFileUploadConfig = (state = fileUploadState) => {
    updateConfig('file_upload', buildFileUploadConfig(state));
  };

  const handleFileUploadToggle = (enabled: boolean) => {
    setFileUploadState(prev => ({ ...prev, fileUploadEnabled: enabled }));
    if (!enabled) {
      updateConfig('file_upload', undefined);
      return;
    }
    generateFileUploadConfig({ ...fileUploadState, fileUploadEnabled: true });
  };

  const addSuggestedQuestion = () => {
    updateConfig('suggested_questions', [
      ...(localConfig.suggested_questions || []),
      '',
    ]);
  };

  const updateSuggestedQuestion = (index: number, value: string) => {
    const questions = [...(localConfig.suggested_questions || [])];
    questions[index] = value;
    updateConfig('suggested_questions', questions);
  };

  const removeSuggestedQuestion = (index: number) => {
    updateConfig(
      'suggested_questions',
      (localConfig.suggested_questions || []).filter(
        (_, itemIndex) => itemIndex !== index
      )
    );
  };

  const handleSave = () => {
    onSave(localConfig);
    setHasChanges(false);
    setInitialFileUploadState(cloneFileUploadPanelState(fileUploadState));
  };

  const handleReset = () => {
    setLocalConfig(createInitializedDifyParametersConfig(config));
    setHasChanges(false);
    setFileUploadState(cloneFileUploadPanelState(initialFileUploadState));
  };

  const toggleFileType = (fileType: string) => {
    setFileUploadState(prev => {
      const enabledFileTypes = new Set(prev.enabledFileTypes);
      if (enabledFileTypes.has(fileType)) {
        enabledFileTypes.delete(fileType);
      } else {
        enabledFileTypes.add(fileType);
      }
      return { ...prev, enabledFileTypes };
    });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-50 cursor-pointer transition-opacity duration-300',
          'bg-black/20 backdrop-blur-sm',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 w-[520px]',
          'transform transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="flex h-full flex-col p-4">
          <div
            className={cn(
              'mt-4 mb-4 flex max-h-[calc(100vh-8rem)] flex-1 flex-col',
              'rounded-2xl border shadow-2xl',
              isDark
                ? 'border-stone-700 bg-stone-900'
                : 'border-stone-200 bg-white'
            )}
          >
            <div
              className={cn(
                'flex flex-shrink-0 items-center justify-between border-b p-6',
                isDark ? 'border-stone-700' : 'border-stone-200'
              )}
            >
              <h2
                className={cn(
                  'font-serif text-xl font-bold',
                  isDark ? 'text-stone-100' : 'text-stone-900'
                )}
              >
                {t('title', { instanceName })}
              </h2>
              <button
                onClick={onClose}
                className={cn(
                  'cursor-pointer rounded-lg p-2 transition-colors',
                  isDark
                    ? 'text-stone-400 hover:bg-stone-700 hover:text-stone-300'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-700'
                )}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-6 p-6 pb-8">
                <BasicSettingsSection
                  isDark={isDark}
                  t={t}
                  localConfig={localConfig}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  updateConfig={updateConfig}
                  fileUploadState={fileUploadState}
                  onFileUploadToggle={handleFileUploadToggle}
                  onOpenFileUploadModal={() => {
                    if (fileUploadState.fileUploadEnabled) {
                      setShowFileUploadModal(true);
                    }
                  }}
                  addSuggestedQuestion={addSuggestedQuestion}
                  updateSuggestedQuestion={updateSuggestedQuestion}
                  removeSuggestedQuestion={removeSuggestedQuestion}
                />

                <AssistantSettingsSection
                  isDark={isDark}
                  t={t}
                  localConfig={localConfig}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  updateConfig={updateConfig}
                />

                <InputSystemSection
                  isDark={isDark}
                  t={t}
                  localConfig={localConfig}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  updateConfig={updateConfig}
                />
              </div>
            </div>

            <div
              className={cn(
                'flex-shrink-0 border-t p-6',
                isDark ? 'border-stone-700' : 'border-stone-200'
              )}
            >
              {hasChanges && (
                <p
                  className={cn(
                    'mb-3 text-center font-serif text-xs',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                >
                  {t('unsavedChanges')}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  disabled={!hasChanges}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3',
                    'font-serif font-medium transition-colors',
                    hasChanges
                      ? isDark
                        ? 'cursor-pointer bg-stone-700 text-stone-200 hover:bg-stone-600'
                        : 'cursor-pointer bg-stone-100 text-stone-700 hover:bg-stone-200'
                      : 'cursor-not-allowed bg-stone-500/20 text-stone-500 opacity-50'
                  )}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('buttons.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3',
                    'font-serif font-medium transition-colors',
                    hasChanges
                      ? isDark
                        ? 'cursor-pointer bg-stone-600 text-white hover:bg-stone-500'
                        : 'cursor-pointer bg-stone-700 text-white hover:bg-stone-800'
                      : 'cursor-not-allowed bg-stone-500/20 text-stone-500 opacity-50'
                  )}
                >
                  <Save className="h-4 w-4" />
                  {t('buttons.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showFileUploadModal && (
        <FileUploadModal
          isDark={isDark}
          t={t}
          fileUploadState={fileUploadState}
          setUploadMethod={value =>
            setFileUploadState(prev => ({ ...prev, uploadMethod: value }))
          }
          setMaxFiles={value =>
            setFileUploadState(prev => ({ ...prev, maxFiles: value }))
          }
          toggleFileType={toggleFileType}
          setCustomFileTypes={value =>
            setFileUploadState(prev => ({ ...prev, customFileTypes: value }))
          }
          onCancel={() => setShowFileUploadModal(false)}
          onSave={() => {
            generateFileUploadConfig();
            setShowFileUploadModal(false);
          }}
        />
      )}
    </>
  );
};

export default DifyParametersPanel;
