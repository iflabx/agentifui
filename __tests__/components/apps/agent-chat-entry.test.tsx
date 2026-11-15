import type { AppInstance } from '@components/apps/types';
import type { ServiceInstanceConfig } from '@lib/types/database';
import { fireEvent, render, screen } from '@testing-library/react';

import AppsPage from '../../../app/(shell)/apps/page';

const mockPush = jest.fn();
const mockFetchApps = jest.fn();
const mockSelectItem = jest.fn();
const mockParams = new URLSearchParams();
let mockConfig: ServiceInstanceConfig;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockParams,
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: () => ({
    apps: [
      {
        id: 'service-uuid',
        instance_id: 'native-app',
        display_name: 'Example',
        config: mockConfig,
      },
    ],
    fetchApps: mockFetchApps,
    isLoading: false,
  }),
}));
jest.mock('@lib/stores/favorite-apps-store', () => ({
  useFavoriteAppsStore: () => ({ favoriteApps: [] }),
}));
jest.mock('@lib/stores/sidebar-store', () => ({
  useSidebarStore: () => ({ selectItem: mockSelectItem }),
}));
jest.mock('@components/apps', () => ({
  AppFilters: () => null,
  AppHeader: () => null,
  AppLoading: () => null,
  AppList: ({
    apps,
    onAppClick,
  }: {
    apps: AppInstance[];
    onAppClick: (app: AppInstance) => void;
  }) => (
    <>
      {apps.map(app => (
        <button key={app.instanceId} onClick={() => onAppClick(app)}>
          {app.displayName}
        </button>
      ))}
    </>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig = {
    backend_type: 'dify',
    app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
  };
});

it('opens an opted-in Dify chatbot with the database UUID, not its native app ID', () => {
  mockConfig.interaction_protocol = 'ag-ui/1.0';
  render(<AppsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Example' }));
  expect(mockPush).toHaveBeenCalledWith('/apps/agent-chat/service-uuid');
});

it('opens LangChain publicly by default without a Dify opt-in', () => {
  mockConfig = { backend_type: 'langchain' };
  render(<AppsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Example' }));
  expect(mockPush).toHaveBeenCalledWith('/apps/agent-chat/service-uuid');
});

it('does not migrate a model app with a stale opt-in even if the marketplace flag exposes its card', () => {
  mockConfig.interaction_protocol = 'ag-ui/1.0';
  mockConfig.app_metadata = {
    app_type: 'model',
    is_marketplace_app: true,
    dify_apptype: 'chatbot',
  };
  render(<AppsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Example' }));
  expect(mockPush).toHaveBeenCalledWith('/apps/chatbot/native-app');
});

it.each([
  'chatbot',
  'agent',
  'chatflow',
  'workflow',
  'text-generation',
] as const)(
  'keeps unselected Dify %s on its existing native app entry',
  type => {
    mockConfig.app_metadata!.dify_apptype = type;
    render(<AppsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    expect(mockPush).toHaveBeenCalledWith(`/apps/${type}/native-app`);
  }
);
