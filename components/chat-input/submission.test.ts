import { bindChatInputConversation } from '@lib/hooks/use-chat-input-route-sync';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';

import { captureDifyInputSubmission } from './submission';

jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  bindChatInputConversation: jest.fn().mockResolvedValue(undefined),
}));

function activate(target: string) {
  const scope = chatInputScope(
    useChatInputStore.getState().actorEpoch,
    'actor',
    'app',
    target
  );
  useChatInputStore.getState().setCurrentRoute(scope);
  useAttachmentStore.getState().setScope(scope);
  return scope;
}

describe('submission-local Dify input acceptance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    useAttachmentStore.getState().resetAll();
    activate('new:A');
    useChatInputStore.getState().setMessage('Question');
  });

  it('consumes the captured scope after leaving, not the current view', () => {
    const original = useChatInputStore.getState().currentRoute;
    useAttachmentStore.getState().addFiles([new File(['a'], 'a.txt')]);
    const accept = captureDifyInputSubmission('Question', 'actor');
    activate('conversation:B');
    useChatInputStore.getState().setMessage('Question');
    useAttachmentStore.getState().addFiles([new File(['b'], 'b.txt')]);
    accept('app', { externalId: 'external-A', taskId: 'task-A' });
    expect(
      useChatInputStore.getState().messagesByRoute[original]
    ).toBeUndefined();
    expect(useAttachmentStore.getState().getFiles(original)).toEqual([]);
    expect(useChatInputStore.getState().message).toBe('Question');
    expect(useAttachmentStore.getState().files[0].name).toBe('b.txt');
    expect(bindChatInputConversation).toHaveBeenCalledWith(
      original,
      'actor',
      'app',
      'external-A',
      undefined
    );
  });

  it('retains newer text and newer uploads in the original scope', () => {
    useAttachmentStore.getState().addFiles([new File(['a'], 'a.txt')]);
    const accept = captureDifyInputSubmission('Question', 'actor');
    useChatInputStore.getState().setMessage('New draft');
    useAttachmentStore.getState().addFiles([new File(['b'], 'b.txt')]);
    accept('app', { externalId: 'external-A', taskId: 'task-A' });
    expect(useChatInputStore.getState().message).toBe('New draft');
    expect(useAttachmentStore.getState().files.map(file => file.name)).toEqual([
      'b.txt',
    ]);
  });

  it('rejects another app and logout/login reuse of the same actor', () => {
    const accept = captureDifyInputSubmission('Question', 'actor');
    accept('other-app', { externalId: 'external-A', taskId: 'task-A' });
    expect(useChatInputStore.getState().message).toBe('Question');
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    activate('new:A');
    useChatInputStore.getState().setMessage('Question');
    accept('app', { externalId: 'external-A', taskId: 'task-A' });
    expect(useChatInputStore.getState().message).toBe('Question');
    expect(bindChatInputConversation).not.toHaveBeenCalled();
  });

  it('registers the accepted scope immediately while passing persistence to the binder', async () => {
    let finish!: (value: string | null) => void;
    const conversationPersistencePromise = new Promise<string | null>(
      resolve => {
        finish = resolve;
      }
    );
    const accept = captureDifyInputSubmission('Question', 'actor');
    accept('app', {
      externalId: 'external-A',
      taskId: 'task-A',
      conversationPersistencePromise,
    });
    expect(useChatInputStore.getState().message).toBe('');
    expect(bindChatInputConversation).toHaveBeenCalledWith(
      expect.any(String),
      'actor',
      'app',
      'external-A',
      conversationPersistencePromise
    );
    useChatInputStore.getState().setActor('other');
    finish('db-A');
    await conversationPersistencePromise;
    expect(bindChatInputConversation).toHaveBeenCalledTimes(1);
  });
});
