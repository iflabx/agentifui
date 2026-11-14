import { useChatInputStore } from '@lib/stores/chat-input-store';

import { sendDirectChatMessage } from './direct-send';

describe('direct message draft ownership', () => {
  beforeEach(() => {
    useChatInputStore.getState().clearAllMessages();
    useChatInputStore.getState().setCurrentRoute('original');
    useChatInputStore.getState().setMessage('Original draft');
  });

  it('restores only an unchanged failed draft', async () => {
    await expect(
      sendDirectChatMessage({
        messageText: 'Suggestion',
        handleSubmit: async () => {
          throw new Error('Rejected');
        },
      })
    ).rejects.toThrow('Rejected');
    expect(useChatInputStore.getState().message).toBe('Original draft');
  });

  it('does not restore the previous route draft into the next route', async () => {
    await expect(
      sendDirectChatMessage({
        messageText: 'Suggestion',
        handleSubmit: async () => {
          useChatInputStore.getState().setCurrentRoute('other');
          useChatInputStore.getState().setMessage('Other draft');
          throw new Error('Rejected');
        },
      })
    ).rejects.toThrow('Rejected');
    expect(useChatInputStore.getState().message).toBe('Other draft');
  });

  it('does not overwrite a newer edit when direct submission fails', async () => {
    await expect(
      sendDirectChatMessage({
        messageText: 'Suggestion',
        handleSubmit: async () => {
          useChatInputStore.getState().setMessage('New edit');
          throw new Error('Rejected');
        },
      })
    ).rejects.toThrow('Rejected');
    expect(useChatInputStore.getState().message).toBe('New edit');
  });
});
