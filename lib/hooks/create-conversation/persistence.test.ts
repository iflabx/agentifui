import {
  saveConversationRecord,
  startConversationTitleResolution,
} from './persistence';
import { selectConversationIfCurrent } from './routing';

const mockCreateConversation = jest.fn();
const mockUpdateConversation = jest.fn();
const mockRenameConversation = jest.fn();
const mockGetPendingState = jest.fn();
const mockEmitConversationEvents = jest.fn();

jest.mock('@lib/services/client/conversations-api', () => ({
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
}));

jest.mock('@lib/services/dify/conversation-service', () => ({
  renameConversation: (...args: unknown[]) => mockRenameConversation(...args),
}));

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: {
    emit: (...args: unknown[]) => mockEmitConversationEvents(...args),
  },
}));

jest.mock('@lib/stores/pending-conversation-store', () => ({
  usePendingConversationStore: {
    getState: (...args: unknown[]) => mockGetPendingState(...args),
  },
}));

jest.mock('./routing', () => ({
  selectConversationIfCurrent: jest.fn(),
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('create-conversation persistence helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPendingState.mockReturnValue({
      markAsPersistedComplete: jest.fn(),
    });
  });

  it('saves a conversation record and returns the DB id', async () => {
    const markAsPersistedComplete = jest.fn();
    mockGetPendingState.mockReturnValue({ markAsPersistedComplete });
    mockCreateConversation.mockResolvedValue({
      success: true,
      data: { id: 'db-1' },
    });

    const updateStatusInPendingStore = jest.fn();
    const updateTitleInPendingStore = jest.fn();
    const addToFavorites = jest.fn();
    const onDbIdCreated = jest.fn();

    const result = await saveConversationRecord({
      difyConvId: 'conv-1',
      title: 'Creating',
      tempConvId: 'temp-1',
      currentUserId: 'user-1',
      appId: 'app-1',
      saveFailedTitle: 'Save failed',
      updateStatusInPendingStore,
      updateTitleInPendingStore,
      addToFavorites,
      onDbIdCreated,
    });

    expect(result).toBe('db-1');
    expect(mockCreateConversation).toHaveBeenCalled();
    expect(markAsPersistedComplete).toHaveBeenCalledWith('conv-1', 'db-1');
    expect(addToFavorites).toHaveBeenCalledWith('app-1');
    expect(onDbIdCreated).toHaveBeenCalledWith('conv-1', 'db-1');
    expect(mockEmitConversationEvents).toHaveBeenCalledTimes(1);
    expect(updateStatusInPendingStore).not.toHaveBeenCalledWith(
      'temp-1',
      'failed'
    );
    expect(updateTitleInPendingStore).not.toHaveBeenCalled();
  });

  it('marks pending state as failed when required identifiers are missing', async () => {
    const updateStatusInPendingStore = jest.fn();
    const updateTitleInPendingStore = jest.fn();

    const result = await saveConversationRecord({
      difyConvId: 'conv-1',
      title: 'Creating',
      tempConvId: 'temp-1',
      currentUserId: undefined,
      appId: 'app-1',
      saveFailedTitle: 'Save failed',
      updateStatusInPendingStore,
      updateTitleInPendingStore,
      addToFavorites: jest.fn(),
    });

    expect(result).toBeNull();
    expect(updateStatusInPendingStore).toHaveBeenCalledWith('temp-1', 'failed');
    expect(updateTitleInPendingStore).toHaveBeenCalledWith(
      'temp-1',
      'Save failed',
      true
    );
  });

  it('resolves and persists the generated title', async () => {
    mockRenameConversation.mockResolvedValue({ name: 'Final title' });
    mockUpdateConversation.mockResolvedValue({ success: true });
    const startTitleTypewriter = jest.fn();

    startConversationTitleResolution({
      appId: 'app-1',
      difyConvId: 'conv-1',
      userIdentifier: 'user-1',
      tempConvId: 'temp-1',
      tempTitle: 'Creating',
      untitledTitle: 'Untitled',
      dbId: 'db-1',
      startTitleTypewriter,
    });

    await flushPromises();

    expect(mockRenameConversation).toHaveBeenCalledWith('app-1', 'conv-1', {
      user: 'user-1',
      auto_generate: true,
    });
    expect(startTitleTypewriter).toHaveBeenCalledWith('temp-1', 'Final title');
    expect(mockUpdateConversation).toHaveBeenCalledWith('db-1', {
      title: 'Final title',
    });
    expect(mockEmitConversationEvents).toHaveBeenCalledTimes(1);
    expect(selectConversationIfCurrent).toHaveBeenCalledWith(
      'conv-1',
      'Error selecting item in sidebar after title'
    );
  });

  it('falls back to untitled when title generation fails', async () => {
    mockRenameConversation.mockRejectedValue(new Error('rename failed'));
    mockUpdateConversation.mockResolvedValue({ success: true });
    const startTitleTypewriter = jest.fn();

    startConversationTitleResolution({
      appId: 'app-1',
      difyConvId: 'conv-2',
      userIdentifier: 'user-2',
      tempConvId: 'temp-2',
      tempTitle: 'Creating',
      untitledTitle: 'Untitled',
      dbId: 'db-2',
      startTitleTypewriter,
    });

    await flushPromises();

    expect(startTitleTypewriter).toHaveBeenCalledWith('temp-2', 'Untitled');
    expect(mockUpdateConversation).toHaveBeenCalledWith('db-2', {
      title: 'Untitled',
    });
    expect(mockEmitConversationEvents).toHaveBeenCalledTimes(1);
    expect(selectConversationIfCurrent).toHaveBeenCalledWith(
      'conv-2',
      'Error selecting item in sidebar (title fetch failed)'
    );
  });
});
