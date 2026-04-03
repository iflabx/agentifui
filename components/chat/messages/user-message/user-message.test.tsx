import { render, screen } from '@testing-library/react';

import { UserMessage } from './user-message';

let lastFileAttachmentDisplayProps: {
  appId?: string;
  attachments: Array<{ app_id?: string; preview_file_id?: string }>;
} | null = null;

jest.mock('@lib/hooks', () => ({
  useMobile: () => false,
  useMounted: () => true,
}));

jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({
    currentAppId: 'current-app',
  }),
}));

jest.mock('@components/chat/message-actions', () => ({
  UserMessageActions: () => <div data-testid="message-actions" />,
}));

jest.mock('./file-attachment-display', () => ({
  FileAttachmentDisplay: (props: {
    appId?: string;
    attachments: Array<{ app_id?: string; preview_file_id?: string }>;
  }) => {
    lastFileAttachmentDisplayProps = props;
    return <div data-testid="attachment-display" />;
  },
}));

describe('UserMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastFileAttachmentDisplayProps = null;
  });

  it('prefers conversationAppId over currentAppId for historical attachment previews', () => {
    render(
      <UserMessage
        id="msg-1"
        content="hello"
        conversationAppId="conversation-app"
        attachments={[
          {
            id: 'att-1',
            name: 'notes.md',
            size: 128,
            type: 'text/markdown',
            upload_file_id: 'file-1',
          },
        ]}
      />
    );

    expect(screen.getByTestId('attachment-display')).toBeInTheDocument();
    expect(lastFileAttachmentDisplayProps?.appId).toBe('conversation-app');
    expect(lastFileAttachmentDisplayProps?.attachments[0]?.app_id).toBe(
      'conversation-app'
    );
  });

  it('keeps the attachment app_id when it already exists', () => {
    render(
      <UserMessage
        id="msg-1"
        content="hello"
        conversationAppId="conversation-app"
        attachments={[
          {
            id: 'att-1',
            name: 'notes.md',
            size: 128,
            type: 'text/markdown',
            upload_file_id: 'file-1',
            app_id: 'attachment-app',
          },
        ]}
      />
    );

    expect(lastFileAttachmentDisplayProps?.appId).toBe('conversation-app');
    expect(lastFileAttachmentDisplayProps?.attachments[0]?.app_id).toBe(
      'attachment-app'
    );
  });

  it('preserves preview_file_id for history preview requests', () => {
    render(
      <UserMessage
        id="msg-1"
        content="hello"
        conversationAppId="conversation-app"
        attachments={[
          {
            id: 'att-1',
            name: 'notes.md',
            size: 128,
            type: 'text/markdown',
            upload_file_id: 'upload-file-1',
            preview_file_id: 'preview-file-1',
          },
        ]}
      />
    );

    expect(
      lastFileAttachmentDisplayProps?.attachments[0]?.preview_file_id
    ).toBe('preview-file-1');
  });
});
