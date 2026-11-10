import { SidebarHeader } from '@components/sidebar/sidebar-header';
import { DynamicTitle } from '@components/ui/dynamic-title';
import { act, render, screen } from '@testing-library/react';

import { generateMetadata } from '../../app/layout';

jest.mock('next/font/local', () => () => ({ variable: 'test-font' }));
jest.mock('next-intl/server', () => ({
  getLocale: jest.fn(),
  getMessages: jest.fn(),
}));
jest.mock('../../app/providers', () => ({ Providers: () => null }));
jest.mock('@components/layouts/body-ready', () => ({ BodyReady: () => null }));
jest.mock('@components/observability/client-error-monitor', () => ({
  ClientErrorMonitor: () => null,
}));
jest.mock('@components/ui/notification-bar', () => ({
  NotificationBar: () => null,
}));
jest.mock('@components/ui/tooltip', () => ({ TooltipContainer: () => null }));
jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'dynamicTitle' && key === 'base') return 'Existing Title';
    if (namespace === 'sidebar' && key === 'appName') return 'Existing Sidebar';
    return `${namespace}.${key}`;
  },
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  useCombinedConversations: () => ({ conversations: [], isLoading: false }),
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: () => ({ apps: [], isLoading: false }),
}));
jest.mock('@lib/stores/sidebar-store', () => ({
  useSidebarStore: () => ({ isExpanded: true }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: (selector: (state: object) => unknown) =>
    selector({ currentConversationId: null }),
}));
jest.mock('@lib/stores/chat-input-store', () => ({
  useChatInputStore: () => jest.fn(),
}));
jest.mock('@lib/stores/chat-transition-store', () => ({
  useChatTransitionStore: () => jest.fn(),
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => ({ clearConversationState: jest.fn() }),
}));
jest.mock('@lib/hooks/use-platform-keys', () => ({
  useFormattedShortcut: () => ({ symbols: [], text: '' }),
}));

const originalName = process.env.NEXT_PUBLIC_BRAND_NAME;

beforeEach(() => {
  jest.useFakeTimers();
  delete process.env.NEXT_PUBLIC_BRAND_NAME;
  document.title = 'Previous Title';
});

afterEach(() => {
  jest.useRealTimers();
  if (originalName === undefined) delete process.env.NEXT_PUBLIC_BRAND_NAME;
  else process.env.NEXT_PUBLIC_BRAND_NAME = originalName;
});

test('configured branding reaches metadata, dynamic title and sidebar without editing messages', () => {
  process.env.NEXT_PUBLIC_BRAND_NAME = '  Example Assistant  ';
  expect(generateMetadata().title).toBe('Example Assistant');
  render(
    <>
      <DynamicTitle />
      <SidebarHeader />
    </>
  );
  act(() => jest.runOnlyPendingTimers());
  expect(document.title).toBe('Example Assistant');
  expect(screen.getByText('Example Assistant')).toBeInTheDocument();
  expect(screen.queryByText('Existing Sidebar')).not.toBeInTheDocument();
});

test.each([undefined, '', '   '])(
  'unconfigured branding preserves existing translated labels (%j)',
  value => {
    if (value !== undefined) process.env.NEXT_PUBLIC_BRAND_NAME = value;
    expect(generateMetadata().title).toBe('AgentifUI');
    render(
      <>
        <DynamicTitle />
        <SidebarHeader />
      </>
    );
    act(() => jest.runOnlyPendingTimers());
    expect(document.title).toBe('Existing Title');
    expect(screen.getByText('Existing Sidebar')).toBeInTheDocument();
  }
);
