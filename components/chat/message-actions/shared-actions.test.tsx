import { fireEvent, render, screen } from '@testing-library/react';

import { AssistantMessageActions } from './assistant-message-actions';
import { UserMessageActions } from './user-message-actions';

jest.mock('@components/ui/message-actions-container', () => ({
  MessageActionsContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('./buttons/copy-button', () => ({
  CopyButton: () => <button>copy</button>,
}));
jest.mock('./buttons/edit-button', () => ({
  EditButton: ({ onEdit }: { onEdit: () => void }) => (
    <button onClick={onEdit}>edit</button>
  ),
}));
jest.mock('./buttons/regenerate-button', () => ({
  RegenerateButton: ({ onRegenerate }: { onRegenerate: () => void }) => (
    <button onClick={onRegenerate}>regenerate</button>
  ),
}));
jest.mock('./buttons/feedback-button', () => ({
  FeedbackButton: ({ onFeedback }: { onFeedback: () => void }) => (
    <button onClick={onFeedback}>feedback</button>
  ),
}));

describe('shared message actions', () => {
  it('only exposes copy without implemented callbacks', () => {
    render(
      <>
        <UserMessageActions messageId="user" content="Question" />
        <AssistantMessageActions messageId="assistant" content="Answer" />
      </>
    );
    expect(screen.getAllByRole('button', { name: 'copy' })).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'edit' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'regenerate' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'feedback' })
    ).not.toBeInTheDocument();
  });
  it('exposes real handlers when supplied', () => {
    const edit = jest.fn();
    const regenerate = jest.fn();
    const feedback = jest.fn();
    render(
      <>
        <UserMessageActions messageId="user" content="Question" onEdit={edit} />
        <AssistantMessageActions
          messageId="assistant"
          content="Answer"
          onRegenerate={regenerate}
          onFeedback={feedback}
        />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'feedback' })[0]);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith(true);
  });
});
