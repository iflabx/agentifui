import type { ServiceInstance } from '@lib/types/database';
import { renderHook } from '@testing-library/react';

import type {
  AgentAttachmentSlot,
  AgentInputCapabilities,
} from '../../packages/shared/src/agent-input';
import {
  fileTypesForSlot,
  useFileTypesFromConfig,
} from './use-file-types-from-config';

const mockLive = jest.fn();
jest.mock('./use-agent-input-capabilities', () => ({
  useAgentInputCapabilities: (...args: unknown[]) => mockLive(...args),
}));
jest.mock('@lib/stores/current-app-store', () => ({
  useCurrentAppStore: () => ({ currentAppInstance: null }),
}));
const slot: AgentAttachmentSlot = {
  key: 'files',
  label: 'Files',
  target: 'files',
  minCount: 0,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['pdf', 'md'],
  maxBytesByType: { document: 12 },
};
const ready: AgentInputCapabilities = {
  version: 1,
  status: 'ready',
  mode: 'conversation',
  text: { enabled: true, required: true, target: 'query' },
  fields: [],
  attachmentSlots: [slot],
};

describe('effective upload types', () => {
  beforeEach(() => {
    mockLive.mockReturnValue({
      capabilities: ready,
      retry: jest.fn(),
      error: null,
      isLoading: false,
    });
  });
  it('uses service instance UUID and live rules, never stored Dify limits', () => {
    const app = {
      id: 'uuid',
      instance_id: 'dify-id',
      config: { dify_parameters: { file_upload: { enabled: false } } },
    } as unknown as ServiceInstance;
    const { result, rerender } = renderHook(
      ({ instance }) => useFileTypesFromConfig(instance),
      { initialProps: { instance: app as ServiceInstance | null } }
    );
    expect(mockLive).toHaveBeenCalledWith('uuid');
    expect(result.current.uploadConfig).toMatchObject({
      enabled: true,
      maxFiles: 3,
    });
    expect(result.current.fileTypes[0]).toMatchObject({
      extensions: ['md', 'pdf'],
      acceptString: '.md,.pdf',
      maxSize: '12 Bytes',
    });
    mockLive.mockReturnValue({ capabilities: null, isLoading: true });
    rerender({ instance: null });
    expect(mockLive).toHaveBeenLastCalledWith(null);
    expect(result.current.uploadConfig.enabled).toBe(false);
  });
  it('supports genuinely custom extensions with the live byte limit', () => {
    expect(
      fileTypesForSlot({
        ...slot,
        allowedTypes: ['custom'],
        extensions: ['xyz'],
        maxBytesByType: { custom: 7 },
      })[0]
    ).toMatchObject({
      title: 'other',
      extensions: ['xyz'],
      maxSize: '7 Bytes',
    });
  });
  it.each([
    { maxCount: 0 },
    { methods: ['remote_url'] },
    { allowedTypes: [] },
    { maxBytesByType: {} },
    { extensions: ['png'] },
  ])('does not invent capability: %s', override => {
    expect(
      fileTypesForSlot({ ...slot, ...override } as AgentAttachmentSlot)
    ).toEqual([]);
  });
  it('keeps shared Dify AG-UI uploads disabled', () => {
    const { result } = renderHook(() =>
      useFileTypesFromConfig({
        id: 'uuid',
        config: { interaction_protocol: 'ag-ui/1.0' },
      } as ServiceInstance)
    );
    expect(result.current.uploadConfig.enabled).toBe(false);
    expect(result.current.capabilities?.attachmentSlots).toEqual([]);
  });
  it('ready text-only applications have no upload controls', () => {
    mockLive.mockReturnValue({
      capabilities: { ...ready, attachmentSlots: [] },
    });
    const { result } = renderHook(() => useFileTypesFromConfig(null));
    expect(result.current.uploadConfig).toMatchObject({
      enabled: false,
      maxFiles: 0,
    });
  });
});
