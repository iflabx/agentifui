import {
  applyTemporaryConversationUi,
  selectConversationIfCurrent,
  syncFallbackConversationPath,
  syncRealConversationUi,
} from './routing';

const mockSelectItem = jest.fn();
const mockSetCurrentConversationId = jest.fn();
const mockGetSidebarState = jest.fn();
const mockGetChatState = jest.fn();

jest.mock('@lib/stores/sidebar-store', () => ({
  useSidebarStore: {
    getState: (...args: unknown[]) => mockGetSidebarState(...args),
  },
}));

jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: {
    getState: (...args: unknown[]) => mockGetChatState(...args),
  },
}));

describe('create-conversation routing helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/chat/new');
    mockGetSidebarState.mockReturnValue({
      selectedId: null,
      selectItem: mockSelectItem,
    });
    mockGetChatState.mockReturnValue({
      currentConversationId: null,
      setCurrentConversationId: mockSetCurrentConversationId,
    });
  });

  it('applies temporary conversation UI immediately', () => {
    applyTemporaryConversationUi('temp-1', mockSetCurrentConversationId);

    expect(window.location.pathname).toBe('/chat/temp-1');
    expect(mockSetCurrentConversationId).toHaveBeenCalledWith('temp-1');
    expect(mockSelectItem).toHaveBeenCalledWith('chat', 'temp-1', true);
  });

  it('syncs the real conversation id into URL and stores', () => {
    window.history.replaceState({}, '', '/chat/temp-1');
    mockGetSidebarState.mockReturnValue({
      selectedId: 'temp-1',
      selectItem: mockSelectItem,
    });
    mockGetChatState.mockReturnValue({
      currentConversationId: 'temp-1',
      setCurrentConversationId: mockSetCurrentConversationId,
    });

    syncRealConversationUi('temp-1', 'real-1');

    expect(window.location.pathname).toBe('/chat/real-1');
    expect(mockSetCurrentConversationId).toHaveBeenCalledWith('real-1');
    expect(mockSelectItem).toHaveBeenCalledWith('chat', 'real-1', true);
  });

  it('updates fallback path and selects current conversation when needed', () => {
    window.history.replaceState({}, '', '/chat/temp-9');

    syncFallbackConversationPath('temp-9', 'real-9');
    expect(window.location.pathname).toBe('/chat/real-9');

    window.history.replaceState({}, '', '/chat/real-9');
    selectConversationIfCurrent('real-9', 'selection failed');

    expect(mockSelectItem).toHaveBeenCalledWith('chat', 'real-9', true);
  });
});
