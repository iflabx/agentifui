/** @jest-environment node */
import {
  buildFileUploadConfig,
  cloneFileUploadPanelState,
  createInitializedDifyParametersConfig,
  extractFileUploadPanelState,
} from '@components/admin/api-config/dify-parameters-panel/file-upload-utils';

describe('dify parameters panel file upload utils', () => {
  it('initializes missing config with defaults', () => {
    expect(createInitializedDifyParametersConfig({})).toMatchObject({
      opening_statement: '',
      suggested_questions: [],
      speech_to_text: { enabled: false },
      system_parameters: {
        file_size_limit: 15,
        image_file_size_limit: 10,
        audio_file_size_limit: 50,
        video_file_size_limit: 100,
      },
    });
  });

  it('extracts file upload panel state from dify config', () => {
    const state = extractFileUploadPanelState({
      file_upload: {
        allowed_file_types: ['image', 'custom'],
        allowed_file_extensions: ['pdf', 'csv'],
        allowed_file_upload_methods: ['local_file'],
        number_limits: 5,
        image: {
          enabled: true,
          number_limits: 5,
          transfer_methods: ['local_file'],
        },
      },
    });

    expect(state.fileUploadEnabled).toBe(true);
    expect(state.uploadMethod).toBe('local');
    expect(state.maxFiles).toBe(5);
    expect(state.enabledFileTypes.has('image')).toBe(true);
  });

  it('builds file upload config from panel state', () => {
    expect(
      buildFileUploadConfig({
        fileUploadEnabled: true,
        uploadMethod: 'both',
        maxFiles: 3,
        enabledFileTypes: new Set(['image', 'other']),
        customFileTypes: 'pdf, csv',
      })
    ).toMatchObject({
      image: {
        enabled: true,
        number_limits: 3,
        transfer_methods: ['local_file', 'remote_url'],
      },
      other: {
        enabled: true,
        number_limits: 3,
        custom_extensions: ['pdf', 'csv'],
      },
    });
  });

  it('clones set-backed state safely', () => {
    const state = cloneFileUploadPanelState({
      fileUploadEnabled: true,
      uploadMethod: 'url',
      maxFiles: 2,
      enabledFileTypes: new Set(['audio']),
      customFileTypes: '',
    });

    state.enabledFileTypes.add('video');
    expect(state.enabledFileTypes.has('video')).toBe(true);
  });
});
