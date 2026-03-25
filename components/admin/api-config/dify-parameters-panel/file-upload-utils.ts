import type { DifyParametersSimplifiedConfig } from '@lib/types/dify-parameters';

export type UploadMethod = 'local' | 'url' | 'both';

export interface FileUploadPanelState {
  fileUploadEnabled: boolean;
  uploadMethod: UploadMethod;
  maxFiles: number;
  enabledFileTypes: Set<string>;
  customFileTypes: string;
}

export const DEFAULT_SYSTEM_PARAMETERS = {
  file_size_limit: 15,
  image_file_size_limit: 10,
  audio_file_size_limit: 50,
  video_file_size_limit: 100,
};

export const DEFAULT_FILE_UPLOAD_STATE: FileUploadPanelState = {
  fileUploadEnabled: false,
  uploadMethod: 'both',
  maxFiles: 3,
  enabledFileTypes: new Set(['image']),
  customFileTypes: '',
};

export function cloneFileUploadPanelState(
  state: FileUploadPanelState
): FileUploadPanelState {
  return {
    ...state,
    enabledFileTypes: new Set(state.enabledFileTypes),
  };
}

export function createInitializedDifyParametersConfig(
  config: DifyParametersSimplifiedConfig
): DifyParametersSimplifiedConfig {
  return {
    opening_statement: config.opening_statement || '',
    suggested_questions: config.suggested_questions || [],
    suggested_questions_after_answer:
      config.suggested_questions_after_answer || { enabled: false },
    speech_to_text: config.speech_to_text || { enabled: false },
    text_to_speech: config.text_to_speech || { enabled: false },
    retriever_resource: config.retriever_resource || { enabled: false },
    annotation_reply: config.annotation_reply || { enabled: false },
    user_input_form: config.user_input_form || [],
    file_upload: config.file_upload,
    system_parameters: config.system_parameters || DEFAULT_SYSTEM_PARAMETERS,
  };
}

export function extractFileUploadPanelState(
  config: DifyParametersSimplifiedConfig
): FileUploadPanelState {
  const fileUploadConfig = config.file_upload;
  const hasFileUpload = Boolean(
    fileUploadConfig?.enabled ||
      fileUploadConfig?.image?.enabled ||
      fileUploadConfig?.document?.enabled ||
      fileUploadConfig?.audio?.enabled ||
      fileUploadConfig?.video?.enabled ||
      fileUploadConfig?.other?.enabled
  );

  let uploadMethod: UploadMethod = 'both';
  let maxFiles = 3;
  const enabledFileTypes = new Set<string>();
  let customFileTypes = '';

  if (hasFileUpload && fileUploadConfig) {
    if (fileUploadConfig.allowed_file_upload_methods) {
      const methods = fileUploadConfig.allowed_file_upload_methods || [];
      if (methods.includes('local_file') && methods.includes('remote_url')) {
        uploadMethod = 'both';
      } else if (methods.includes('local_file')) {
        uploadMethod = 'local';
      } else if (methods.includes('remote_url')) {
        uploadMethod = 'url';
      }

      maxFiles =
        fileUploadConfig.number_limits ||
        fileUploadConfig.max_files ||
        fileUploadConfig.file_count_limit ||
        3;
    } else {
      const configSource =
        fileUploadConfig.image ||
        fileUploadConfig.document ||
        fileUploadConfig.audio ||
        fileUploadConfig.video ||
        fileUploadConfig.other;

      if (configSource) {
        maxFiles = configSource.number_limits || 3;
        const methods = configSource.transfer_methods || [];
        if (methods.includes('local_file') && methods.includes('remote_url')) {
          uploadMethod = 'both';
        } else if (methods.includes('local_file')) {
          uploadMethod = 'local';
        } else if (methods.includes('remote_url')) {
          uploadMethod = 'url';
        }
      }
    }

    if (fileUploadConfig.allowed_file_types) {
      const allowedTypes = fileUploadConfig.allowed_file_types;
      const hasStandardTypes = allowedTypes.some(type =>
        ['image', 'document', 'audio', 'video'].includes(type)
      );

      if (hasStandardTypes) {
        ['image', 'document', 'audio', 'video'].forEach(type => {
          if (allowedTypes.includes(type)) {
            enabledFileTypes.add(type);
          }
        });
      } else if (allowedTypes.includes('custom')) {
        enabledFileTypes.add('other');
        if (fileUploadConfig.allowed_file_extensions) {
          customFileTypes = fileUploadConfig.allowed_file_extensions.join(', ');
        }
      } else {
        enabledFileTypes.add('other');
      }
    } else {
      if (fileUploadConfig.image?.enabled) enabledFileTypes.add('image');
      if (fileUploadConfig.document?.enabled) enabledFileTypes.add('document');
      if (fileUploadConfig.audio?.enabled) enabledFileTypes.add('audio');
      if (fileUploadConfig.video?.enabled) enabledFileTypes.add('video');
      if (fileUploadConfig.other?.enabled) {
        enabledFileTypes.add('other');
        customFileTypes =
          fileUploadConfig.other.custom_extensions?.join(', ') || '';
      }
    }
  }

  return {
    fileUploadEnabled: hasFileUpload,
    uploadMethod,
    maxFiles,
    enabledFileTypes,
    customFileTypes,
  };
}

export function buildFileUploadConfig(
  state: FileUploadPanelState
): DifyParametersSimplifiedConfig['file_upload'] {
  const transferMethods: ('local_file' | 'remote_url')[] =
    state.uploadMethod === 'local'
      ? ['local_file']
      : state.uploadMethod === 'url'
        ? ['remote_url']
        : ['local_file', 'remote_url'];

  const fileUploadConfig: NonNullable<
    DifyParametersSimplifiedConfig['file_upload']
  > = {};

  if (state.enabledFileTypes.has('image')) {
    fileUploadConfig.image = {
      enabled: true,
      number_limits: state.maxFiles,
      transfer_methods: transferMethods,
    };
  }
  if (state.enabledFileTypes.has('document')) {
    fileUploadConfig.document = {
      enabled: true,
      number_limits: state.maxFiles,
      transfer_methods: transferMethods,
    };
  }
  if (state.enabledFileTypes.has('audio')) {
    fileUploadConfig.audio = {
      enabled: true,
      number_limits: state.maxFiles,
      transfer_methods: transferMethods,
    };
  }
  if (state.enabledFileTypes.has('video')) {
    fileUploadConfig.video = {
      enabled: true,
      number_limits: state.maxFiles,
      transfer_methods: transferMethods,
    };
  }
  if (state.enabledFileTypes.has('other') && state.customFileTypes.trim()) {
    fileUploadConfig.other = {
      enabled: true,
      number_limits: state.maxFiles,
      transfer_methods: transferMethods,
      custom_extensions: state.customFileTypes
        .split(/[\s,]+/)
        .filter(ext => ext.trim()),
    };
  }

  return Object.keys(fileUploadConfig).length > 0
    ? fileUploadConfig
    : undefined;
}
