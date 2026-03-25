import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';

import type { FileUploadPanelState, UploadMethod } from './file-upload-utils';

export interface DifyParametersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: DifyParametersSimplifiedConfig;
  onSave: (config: DifyParametersSimplifiedConfig) => void;
  instanceName?: string;
}

export type DifyParametersTranslate = (
  key: string,
  values?: Record<string, string | number | Date>
) => string;

export interface DifyPanelSectionProps {
  isDark: boolean;
  t: DifyParametersTranslate;
  localConfig: DifyParametersSimplifiedConfig;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  updateConfig: (path: string, value: unknown) => void;
}

export interface BasicSettingsSectionProps extends DifyPanelSectionProps {
  fileUploadState: FileUploadPanelState;
  onFileUploadToggle: (enabled: boolean) => void;
  onOpenFileUploadModal: () => void;
  addSuggestedQuestion: () => void;
  updateSuggestedQuestion: (index: number, value: string) => void;
  removeSuggestedQuestion: (index: number) => void;
}

export interface FileUploadModalProps {
  isDark: boolean;
  t: DifyParametersTranslate;
  fileUploadState: FileUploadPanelState;
  setUploadMethod: (value: UploadMethod) => void;
  setMaxFiles: (value: number) => void;
  toggleFileType: (fileType: string) => void;
  setCustomFileTypes: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}
