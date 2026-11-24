import { ChatInputView } from '@components/chat-input/view';
import { render, screen } from '@testing-library/react';

import { ChatSessionView } from './chat-session-view';

jest.mock('@components/chat', () => ({
  ChatInputBackdrop: () => null,
  ScrollToBottomButton: () => null,
}));
jest.mock('@components/file-preview/file-preview-canvas', () => ({
  FilePreviewCanvas: () => null,
}));
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => false }));

it('keeps the same composer mounted from app welcome to conversation', () => {
  const session = (welcome: boolean) => (
    <ChatSessionView
      appLayout
      appTitle="Example app"
      showWelcome={welcome}
      composer={
        <ChatInputView
          value="draft"
          onValueChange={jest.fn()}
          onSubmit={jest.fn()}
        />
      }
    >
      <p>Saved answer</p>
    </ChatSessionView>
  );
  const view = render(session(true));
  const input = screen.getByRole('textbox');
  const frame = input.closest('[data-app-chat-composer]');
  expect(frame).toHaveAttribute('data-app-chat-composer', 'welcome');
  expect(frame).toHaveClass('inset-0', 'px-4', 'overflow-y-auto');
  expect(input.closest('[data-chat-input-container]')).toHaveClass('relative');
  expect(screen.queryByText('Saved answer')).not.toBeInTheDocument();
  view.rerender(session(false));
  expect(screen.getByRole('textbox')).toBe(input);
  expect(frame).toHaveAttribute('data-app-chat-composer', 'conversation');
  expect(frame).not.toHaveClass('absolute');
  expect(
    screen.getByRole('heading', { name: 'Example app' })
  ).toBeInTheDocument();
  expect(screen.getByText('Saved answer')).toBeInTheDocument();
});

it('puts the home greeting, model selector and suggestions inside the common composer', () => {
  const view = render(
    <ChatSessionView
      appLayout
      showWelcome
      composer={
        <ChatInputView
          value=""
          onValueChange={jest.fn()}
          onSubmit={jest.fn()}
          beforeInput={<p>Personal welcome</p>}
          modelSelector={<button type="button">Select model</button>}
          afterInput={<button type="button">Suggested question</button>}
        />
      }
    >
      <p>Saved answer</p>
    </ChatSessionView>
  );
  const frame = view.container.querySelector(
    '[data-app-chat-composer="welcome"]'
  );
  const input = screen.getByRole('textbox');
  const inputCard = input.closest('[data-chat-input-container]');
  expect(inputCard).toHaveClass('relative');
  expect(frame).toContainElement(screen.getByText('Personal welcome'));
  expect(inputCard).toContainElement(
    screen.getByRole('button', { name: 'Select model' })
  );
  expect(frame).toContainElement(
    screen.getByRole('button', { name: 'Suggested question' })
  );
});
