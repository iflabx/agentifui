import { renderHook } from '@testing-library/react';

import { useFileTypesFromConfig } from './use-file-types-from-config';

const mockUseCurrentAppStore = jest.fn();

jest.mock('@lib/stores/current-app-store', () => ({
  useCurrentAppStore: () => mockUseCurrentAppStore(),
}));

describe('useFileTypesFromConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('limits file extensions to the configured allowlist when provided', () => {
    mockUseCurrentAppStore.mockReturnValue({
      currentAppInstance: {
        config: {
          dify_parameters: {
            file_upload: {
              enabled: true,
              number_limits: 3,
              allowed_file_types: ['document'],
              allowed_file_extensions: ['.PDF', '.md'],
              allowed_file_upload_methods: ['local_file'],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useFileTypesFromConfig());

    expect(result.current.fileTypes).toEqual([
      expect.objectContaining({
        title: 'document',
        extensions: ['md', 'pdf'],
        acceptString: '.md,.pdf',
      }),
    ]);
    expect(result.current.uploadConfig.enabled).toBe(true);
  });

  it('disables upload when the configured extension allowlist excludes the enabled type', () => {
    mockUseCurrentAppStore.mockReturnValue({
      currentAppInstance: {
        config: {
          dify_parameters: {
            file_upload: {
              enabled: true,
              number_limits: 3,
              allowed_file_types: ['document'],
              allowed_file_extensions: ['.png'],
              allowed_file_upload_methods: ['local_file'],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useFileTypesFromConfig());

    expect(result.current.fileTypes).toEqual([]);
    expect(result.current.uploadConfig.enabled).toBe(false);
  });
});
