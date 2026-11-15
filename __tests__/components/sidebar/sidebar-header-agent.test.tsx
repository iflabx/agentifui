import { SidebarHeader } from '@components/sidebar/sidebar-header';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

const mockPush = jest.fn();
const mockSelectItem = jest.fn();
const mockChatState = {
  clearMessages: jest.fn(),
  setCurrentConversationId: jest.fn(),
  setIsWaitingForResponse: jest.fn(),
};
const mockSidebarState = {
  isExpanded: true,
  selectedType: null,
  selectedId: null,
  selectItem: mockSelectItem,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/config/branding', () => ({
  getDisplayBrandName: (name: string) => name,
}));
jest.mock('@lib/hooks/use-platform-keys', () => ({
  useFormattedShortcut: () => ({ symbols: [] }),
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => ({ clearConversationState: jest.fn() }),
}));
jest.mock('@lib/stores/sidebar-store', () => ({
  useSidebarStore: Object.assign(() => mockSidebarState, {
    getState: () => mockSidebarState,
  }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof mockChatState) => unknown) =>
      selector(mockChatState),
    { getState: () => mockChatState }
  ),
}));
jest.mock('@lib/stores/chat-input-store', () => ({
  useChatInputStore: () => ({ setIsWelcomeScreen: jest.fn() }),
}));
jest.mock('@lib/stores/chat-transition-store', () => ({
  useChatTransitionStore: () => ({ setIsTransitioningToWelcome: jest.fn() }),
}));
jest.mock('@components/ui/adaptive-key-badge', () => ({
  KeyCombination: () => null,
}));
jest.mock('@components/sidebar/sidebar-button', () => ({
  SidebarButton: ({
    children,
    onClick,
    active,
    'aria-label': label,
  }: {
    children: ReactNode;
    onClick: () => void;
    active: boolean;
    'aria-label': string;
  }) => (
    <button onClick={onClick} aria-label={label} data-active={active}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each(['agent-chat', 'langchain'])(
  'keeps new-chat navigation on the current %s app and removes the conversation query',
  prefix => {
    window.history.replaceState(
      {},
      '',
      `/apps/${prefix}/service?conversationId=local`
    );
    render(<SidebarHeader />);
    const button = screen.getByRole('button', { name: 'newChat' });
    expect(button).toHaveAttribute('data-active', 'false');
    fireEvent.click(button);
    expect(mockPush).toHaveBeenCalledWith(`/apps/${prefix}/service`);
  }
);

it('recognizes the common new-chat page without starting another navigation', () => {
  window.history.replaceState({}, '', '/apps/agent-chat/service');
  render(<SidebarHeader />);
  const button = screen.getByRole('button', { name: 'newChat' });
  expect(button).toHaveAttribute('data-active', 'true');
  fireEvent.click(button);
  expect(mockPush).not.toHaveBeenCalled();
});
